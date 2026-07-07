using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public interface IDesignRepository
{
    Task<DesignModel?> GetFullByIdAsync(int designModelId, bool track, CancellationToken cancellationToken = default);
    Task<DesignModel?> GetFullByProjectIdAsync(int projectId, bool track, CancellationToken cancellationToken = default);
    Task<int?> FindDesignModelIdByTableIdAsync(int tableId, CancellationToken cancellationToken = default);
    Task<int?> FindDesignModelIdByColumnIdAsync(int columnId, CancellationToken cancellationToken = default);
    Task<int?> FindDesignModelIdByRelationshipIdAsync(int relationshipId, CancellationToken cancellationToken = default);
    Task AddAsync(DesignModel design, CancellationToken cancellationToken = default);
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
