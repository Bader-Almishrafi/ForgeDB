using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IDatasetImportService
{
    Task<DatasetResponseDto> ImportDatasetAsync(DatasetUploadDto request, CancellationToken cancellationToken = default);
    Task<IEnumerable<DatasetResponseDto>> GetProjectDatasetsAsync(int projectId, CancellationToken cancellationToken = default);
}
