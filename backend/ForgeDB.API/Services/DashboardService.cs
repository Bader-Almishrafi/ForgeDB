using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class DashboardService : IDashboardService
{
    private readonly IDatasetRepository _datasetRepository;

    public DashboardService(IDatasetRepository datasetRepository)
    {
        _datasetRepository = datasetRepository;
    }

    public async Task<DashboardResponseDto> GetDatasetDashboardAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        if (datasetId <= 0)
        {
            throw new ArgumentException("DatasetId must be greater than zero.", nameof(datasetId));
        }

        var dataset = await _datasetRepository.GetByIdWithRowsAndColumnsAsync(datasetId, cancellationToken);

        if (dataset is null)
        {
            throw new KeyNotFoundException("Dataset not found.");
        }

        return DatasetAnalysisBuilder.Build(dataset).Dashboard;
    }
}
