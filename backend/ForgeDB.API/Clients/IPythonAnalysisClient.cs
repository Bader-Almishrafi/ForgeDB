using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Clients;

public interface IPythonAnalysisClient
{
    Task<PythonAnalysisResponseDto> AnalyzeDatasetAsync(PythonAnalysisRequestDto request, CancellationToken cancellationToken = default);
    Task<PythonCleaningResponseDto> PreviewCleaningAsync(PythonCleaningRequestDto request, CancellationToken cancellationToken = default);
    Task<PythonCleaningResponseDto> ApplyCleaningAsync(PythonCleaningRequestDto request, CancellationToken cancellationToken = default);
}

