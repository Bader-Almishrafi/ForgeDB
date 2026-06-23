using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Clients;

public interface IPythonAnalysisClient
{
    Task<PythonAnalysisResponseDto> AnalyzeDatasetAsync(PythonAnalysisRequestDto request, CancellationToken cancellationToken = default);
}

