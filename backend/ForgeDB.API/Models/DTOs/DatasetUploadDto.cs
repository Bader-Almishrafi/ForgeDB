using Microsoft.AspNetCore.Http;

namespace ForgeDB.API.Models.DTOs;

public class DatasetUploadDto
{
    public string TableName { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public string? SourceName { get; set; }
    public string? SourceUrl { get; set; }
    public string? WorksheetName { get; set; }
    public IFormFile? File { get; set; }
}
