using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class DatasetImportService : IDatasetImportService
{
    private readonly IDatasetRepository _datasetRepository;

    public DatasetImportService(IDatasetRepository datasetRepository)
    {
        _datasetRepository = datasetRepository;
    }

    public Task<DatasetResponseDto> ImportDatasetAsync(DatasetUploadDto request, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IEnumerable<DatasetResponseDto>> GetProjectDatasetsAsync(int projectId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
