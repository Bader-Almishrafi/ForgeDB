using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class DashboardService : IDashboardService
{
    public Task<DashboardResponseDto> GetProjectDashboardAsync(int projectId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
