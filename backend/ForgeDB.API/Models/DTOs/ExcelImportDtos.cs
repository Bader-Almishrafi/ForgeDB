using Microsoft.AspNetCore.Http;

namespace ForgeDB.API.Models.DTOs;

public sealed class ExcelPreviewRequestDto
{
    public IFormFile? File { get; set; }
    public string? WorksheetName { get; set; }
}

public sealed class ExcelWorkbookPreviewDto
{
    public string FileName { get; set; } = string.Empty;
    public IReadOnlyList<string> Worksheets { get; set; } = [];
    public string? SelectedWorksheet { get; set; }
    public int RowCount { get; set; }
    public int ColumnCount { get; set; }
    public IReadOnlyList<string> Columns { get; set; } = [];
    public IReadOnlyList<IDictionary<string, object?>> Rows { get; set; } = [];
}
