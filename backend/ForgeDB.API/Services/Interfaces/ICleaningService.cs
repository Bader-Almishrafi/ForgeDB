using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface ICleaningService
{
    Task<ProjectCleaningSummaryDto> GetSummaryAsync(int projectId, int userId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<CleaningSuggestionDto>> GetSuggestionsAsync(int projectId, int userId, int? datasetId, string? issueType, string? column, string? search, CancellationToken cancellationToken = default);
    Task<CleaningPreviewResponseDto> PreviewAsync(int projectId, int userId, CleaningPreviewRequestDto request, CancellationToken cancellationToken = default);
    Task<CleaningApplyResponseDto> ApplyAsync(int projectId, int userId, CleaningApplyRequestDto request, CancellationToken cancellationToken = default);
    Task<CleaningApplyResponseDto> ApplyRecommendedAsync(int projectId, int userId, CleaningApplyRecommendedRequestDto request, CancellationToken cancellationToken = default);
    Task<CleaningHistoryDto> GetHistoryAsync(int projectId, int userId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<DatasetVersionDto>> GetVersionsAsync(int projectId, int datasetId, int userId, CancellationToken cancellationToken = default);
    Task<CleanedDatasetPreviewDto> GetActivePreviewAsync(int projectId, int datasetId, int userId, CancellationToken cancellationToken = default);
    Task<CleaningApplyResponseDto> UndoLatestAsync(int projectId, int userId, CancellationToken cancellationToken = default);
    Task<CleaningApplyResponseDto> RestoreVersionAsync(int projectId, int datasetId, int userId, CleaningRestoreRequestDto request, CancellationToken cancellationToken = default);
    Task<QualityConfirmationDto> ConfirmQualityAsync(int projectId, int userId, CancellationToken cancellationToken = default);
}
