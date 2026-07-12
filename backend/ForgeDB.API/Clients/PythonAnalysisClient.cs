using System.Net.Http.Json;
using System.Text.Json;
using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Clients;

public class PythonAnalysisClient : IPythonAnalysisClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;

    public PythonAnalysisClient(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<PythonAnalysisResponseDto> AnalyzeDatasetAsync(
        PythonAnalysisRequestDto request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        using var response = await _httpClient.PostAsJsonAsync("analyze", request, JsonOptions, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException(
                $"Python analysis service returned {(int)response.StatusCode} {response.ReasonPhrase}: {Truncate(responseBody)}",
                null,
                response.StatusCode);
        }

        var analysis = await response.Content.ReadFromJsonAsync<PythonAnalysisResponseDto>(JsonOptions, cancellationToken);

        return analysis ?? throw new InvalidOperationException("Python analysis service returned an empty response.");
    }

    public Task<PythonCleaningResponseDto> PreviewCleaningAsync(
        PythonCleaningRequestDto request,
        CancellationToken cancellationToken = default)
    {
        return SendCleaningAsync("cleaning/preview", request, cancellationToken);
    }

    public Task<PythonCleaningResponseDto> ApplyCleaningAsync(
        PythonCleaningRequestDto request,
        CancellationToken cancellationToken = default)
    {
        return SendCleaningAsync("cleaning/apply", request, cancellationToken);
    }

    private async Task<PythonCleaningResponseDto> SendCleaningAsync(
        string path,
        PythonCleaningRequestDto request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        using var response = await _httpClient.PostAsJsonAsync(path, request, JsonOptions, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException(
                $"Python cleaning service returned {(int)response.StatusCode} {response.ReasonPhrase}: {Truncate(responseBody)}",
                null,
                response.StatusCode);
        }

        return await response.Content.ReadFromJsonAsync<PythonCleaningResponseDto>(JsonOptions, cancellationToken)
            ?? throw new InvalidOperationException("Python cleaning service returned an empty response.");
    }

    private static string Truncate(string value)
    {
        const int limit = 500;

        if (string.IsNullOrWhiteSpace(value))
        {
            return "<empty response body>";
        }

        return value.Length <= limit ? value : $"{value[..limit]}...";
    }
}
