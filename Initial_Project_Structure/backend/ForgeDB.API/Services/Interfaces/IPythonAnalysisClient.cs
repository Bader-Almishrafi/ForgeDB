using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IPythonAnalysisClient
{
    Task<PythonAnalysisResponseDto> AnalyzeDatasetAsync(PythonAnalysisRequestDto request, CancellationToken cancellationToken = default);
}
