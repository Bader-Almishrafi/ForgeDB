using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Importing;

public sealed record ApiJsonImportData(
    TabularImportData Data,
    Uri FinalUri,
    string? ArrayPath,
    int StatusCode,
    string ContentType,
    long ResponseBytes);

public interface IApiJsonImportService
{
    Task<ApiJsonImportData> FetchAsync(ApiJsonImportRequestDto request, CancellationToken cancellationToken = default);
}
