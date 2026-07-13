using Microsoft.AspNetCore.Http;

namespace ForgeDB.API.Services.Importing;

public interface IExcelWorkbookReader
{
    Task<ExcelWorkbookData> ReadAsync(
        IFormFile file,
        string? worksheetName,
        CancellationToken cancellationToken = default);
}
