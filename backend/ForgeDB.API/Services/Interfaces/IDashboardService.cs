using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IDashboardService
{
    Task<DashboardResponseDto> GetProjectDashboardAsync(int projectId, CancellationToken cancellationToken = default);
}
