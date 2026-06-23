using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IDatasetImportService
{
    Task<DatasetResponseDto> UploadDatasetAsync(int projectId, DatasetUploadDto request, CancellationToken cancellationToken = default);
    Task<IEnumerable<DatasetResponseDto>> GetProjectDatasetsAsync(int projectId, CancellationToken cancellationToken = default);
    Task<DatasetPreviewDto> GetDatasetPreviewAsync(int datasetId, CancellationToken cancellationToken = default);
    Task<DatasetAnalysisResponseDto> AnalyzeDatasetAsync(int datasetId, DatasetAnalysisRequestDto request, CancellationToken cancellationToken = default);
}
