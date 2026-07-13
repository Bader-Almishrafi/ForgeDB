using System.Net;
using Microsoft.Extensions.Options;

namespace ForgeDB.API.Services.Importing;

public sealed class ApiJsonClient : IApiJsonClient
{
    private readonly HttpClient _httpClient;
    private readonly IHostAddressResolver _resolver;
    private readonly ApiImportOptions _options;
    private readonly bool _allowPrivate;

    public ApiJsonClient(
        HttpClient httpClient,
        IHostAddressResolver resolver,
        IOptions<ApiImportOptions> options,
        IHostEnvironment environment)
    {
        _httpClient = httpClient;
        _resolver = resolver;
        _options = options.Value;
        _allowPrivate = environment.IsDevelopment() && _options.AllowPrivateNetworkInDevelopment;
    }

    public async Task<ApiJsonPayload> GetAsync(string url, CancellationToken cancellationToken = default)
    {
        var current = ApiUrlSecurity.ParseAndValidate(url);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(_options.TimeoutSeconds, 1, 120)));

        for (var redirect = 0; ; redirect++)
        {
            await EnsureAllowedAsync(current, timeout.Token);
            using var request = new HttpRequestMessage(HttpMethod.Get, current);
            request.Headers.Accept.ParseAdd("application/json");
            request.Headers.UserAgent.ParseAdd("ForgeDB-ApiImport/1.0");

            HttpResponseMessage response;
            try
            {
                response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            }
            catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
            {
                throw new ApiImportException("timeout", "The API request timed out.", StatusCodes.Status504GatewayTimeout, exception);
            }
            catch (HttpRequestException exception)
            {
                throw new ApiImportException("connection_error", "The API connection failed.", StatusCodes.Status502BadGateway, exception);
            }

            using (response)
            {
                if (IsRedirect(response.StatusCode))
                {
                    if (redirect >= Math.Clamp(_options.MaximumRedirects, 0, 10))
                    {
                        throw new ApiImportException("redirect_limit", "The API response exceeded the redirect limit.", StatusCodes.Status502BadGateway);
                    }
                    var location = response.Headers.Location
                        ?? throw new ApiImportException("invalid_redirect", "The API returned a redirect without a valid Location header.", StatusCodes.Status502BadGateway);
                    current = location.IsAbsoluteUri ? location : new Uri(current, location);
                    current = ApiUrlSecurity.ParseAndValidate(current.AbsoluteUri);
                    continue;
                }

                if (!response.IsSuccessStatusCode)
                {
                    throw new ApiImportException(
                        "http_error",
                        $"The API returned HTTP {(int)response.StatusCode} ({response.ReasonPhrase ?? "error"}).",
                        StatusCodes.Status502BadGateway);
                }

                var mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
                if (!IsJsonMediaType(mediaType))
                {
                    throw new ApiImportException("non_json", "The API response Content-Type is not JSON.", StatusCodes.Status422UnprocessableEntity);
                }

                var maximum = Math.Clamp(_options.MaximumResponseBytes, 1_024, 50 * 1024 * 1024);
                if (response.Content.Headers.ContentLength is > 0 && response.Content.Headers.ContentLength > maximum)
                {
                    throw new ApiImportException("response_too_large", $"The API response exceeds the {maximum / 1024 / 1024} MB limit.", StatusCodes.Status413PayloadTooLarge);
                }

                try
                {
                    await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
                    await using var buffer = new MemoryStream();
                    var chunk = new byte[16 * 1024];
                    while (true)
                    {
                        var read = await stream.ReadAsync(chunk, timeout.Token);
                        if (read == 0) break;
                        if (buffer.Length + read > maximum)
                        {
                            throw new ApiImportException("response_too_large", $"The API response exceeds the {maximum / 1024 / 1024} MB limit.", StatusCodes.Status413PayloadTooLarge);
                        }
                        await buffer.WriteAsync(chunk.AsMemory(0, read), timeout.Token);
                    }
                    return new ApiJsonPayload(current, (int)response.StatusCode, mediaType, buffer.ToArray());
                }
                catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
                {
                    throw new ApiImportException("timeout", "The API response timed out while downloading.", StatusCodes.Status504GatewayTimeout, exception);
                }
            }
        }
    }

    private async Task EnsureAllowedAsync(Uri uri, CancellationToken cancellationToken)
    {
        IPAddress[] addresses;
        try
        {
            addresses = IPAddress.TryParse(uri.IdnHost, out var literal)
                ? [literal]
                : await _resolver.ResolveAsync(uri.IdnHost, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (exception is HttpRequestException or System.Net.Sockets.SocketException)
        {
            throw new ApiImportException("dns_error", "The API host could not be resolved.", StatusCodes.Status502BadGateway, exception);
        }
        ApiUrlSecurity.EnsureAddressesAllowed(uri.IdnHost, addresses, _allowPrivate);
    }

    private static bool IsRedirect(HttpStatusCode statusCode) => statusCode is
        HttpStatusCode.MovedPermanently or HttpStatusCode.Redirect or HttpStatusCode.RedirectMethod
        or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect;

    private static bool IsJsonMediaType(string mediaType) =>
        mediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase)
        || mediaType.Equals("text/json", StringComparison.OrdinalIgnoreCase)
        || mediaType.EndsWith("+json", StringComparison.OrdinalIgnoreCase);
}
