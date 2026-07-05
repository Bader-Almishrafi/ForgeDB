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
