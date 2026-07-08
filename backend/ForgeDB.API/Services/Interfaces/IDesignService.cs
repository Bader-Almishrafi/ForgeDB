using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public class DesignExportArtifacts
{
    public int DesignId { get; set; }
    public int Revision { get; set; }
    public List<ValidationIssueDto> ValidationIssues { get; set; } = new();
    public List<DesignRelationshipResponseDto> Relationships { get; set; } = new();
    public string Sql { get; set; } = string.Empty;
    public string Dbml { get; set; } = string.Empty;
    public string Json { get; set; } = string.Empty;
}

public interface IDesignService
{
    Task<DesignResponseDto?> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default);
    Task<DesignResponseDto> GenerateAsync(int projectId, GenerateDesignRequestDto request, int? ifMatchRevision, CancellationToken cancellationToken = default);
    Task<string> PreviewAsync(int designId, string format, CancellationToken cancellationToken = default);
    Task<List<ValidationIssueDto>> GetValidationAsync(int designId, CancellationToken cancellationToken = default);
    Task<DesignExportArtifacts?> PrepareExportArtifactsAsync(int projectId, CancellationToken cancellationToken = default);

    Task<DesignResponseDto> CreateTableAsync(int designId, int ifMatchRevision, CreateDesignTableRequestDto request, CancellationToken cancellationToken = default);
    Task<DesignResponseDto> UpdateTableAsync(int tableId, int ifMatchRevision, UpdateDesignTableRequestDto request, CancellationToken cancellationToken = default);
    Task<DesignResponseDto> DeleteTableAsync(int tableId, int ifMatchRevision, CancellationToken cancellationToken = default);

    Task<DesignResponseDto> CreateColumnAsync(int tableId, int ifMatchRevision, CreateDesignColumnRequestDto request, CancellationToken cancellationToken = default);
    Task<DesignResponseDto> UpdateColumnAsync(int columnId, int ifMatchRevision, UpdateDesignColumnRequestDto request, CancellationToken cancellationToken = default);
    Task<DesignResponseDto> DeleteColumnAsync(int columnId, int ifMatchRevision, CancellationToken cancellationToken = default);

    Task<DesignResponseDto> CreateRelationshipAsync(int designId, int ifMatchRevision, CreateDesignRelationshipRequestDto request, CancellationToken cancellationToken = default);
    Task<DesignResponseDto> UpdateRelationshipAsync(int relationshipId, int ifMatchRevision, UpdateDesignRelationshipRequestDto request, CancellationToken cancellationToken = default);
    Task<DesignResponseDto> DeleteRelationshipAsync(int relationshipId, int ifMatchRevision, CancellationToken cancellationToken = default);

    Task<DesignResponseDto> UpdateLayoutAsync(int designId, int ifMatchRevision, UpdateDesignLayoutRequestDto request, CancellationToken cancellationToken = default);
}
