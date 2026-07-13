using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IDatasetImportService
{
    Task<DatasetResponseDto> UploadDatasetAsync(int projectId, DatasetUploadDto request, CancellationToken cancellationToken = default);
    Task<ExcelWorkbookPreviewDto> PreviewExcelAsync(ExcelPreviewRequestDto request, CancellationToken cancellationToken = default);
    Task<IEnumerable<DatasetResponseDto>> GetProjectDatasetsAsync(int projectId, CancellationToken cancellationToken = default);
    Task<DatasetPreviewDto> GetDatasetPreviewAsync(int datasetId, CancellationToken cancellationToken = default);
    Task<DatasetAnalysisResponseDto> GetDatasetAnalysisAsync(int datasetId, CancellationToken cancellationToken = default);
    Task<DatasetAnalysisResponseDto> AnalyzeDatasetAsync(int datasetId, DatasetAnalysisRequestDto request, CancellationToken cancellationToken = default);
    Task<bool> DeleteDatasetAsync(int datasetId, CancellationToken cancellationToken = default);
    Task<DatasetResponseDto?> ReplaceDatasetAsync(int datasetId, DatasetUploadDto request, CancellationToken cancellationToken = default);
}
