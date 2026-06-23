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

    public Task<DashboardResponseDto> GetDatasetDashboardAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
