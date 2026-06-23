using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IDashboardService
{
    Task<DashboardResponseDto> GetDatasetDashboardAsync(int datasetId, CancellationToken cancellationToken = default);
}
