using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Clients;

public class PythonAnalysisClient : IPythonAnalysisClient
{
    private readonly HttpClient _httpClient;

    public PythonAnalysisClient(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public Task<PythonAnalysisResponseDto> AnalyzeDatasetAsync(PythonAnalysisRequestDto request, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
