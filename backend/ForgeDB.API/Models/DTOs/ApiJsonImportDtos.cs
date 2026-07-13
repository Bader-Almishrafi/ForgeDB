namespace ForgeDB.API.Models.DTOs;

public sealed class ApiJsonImportRequestDto
{
    public string ApiUrl { get; set; } = string.Empty;
    public string? ArrayPath { get; set; }
    public string? TableName { get; set; }
}

public sealed class ApiConnectionTestDto
{
    public bool Success { get; set; }
    public string Url { get; set; } = string.Empty;
    public int StatusCode { get; set; }
    public string ContentType { get; set; } = string.Empty;
    public long ResponseBytes { get; set; }
    public int RecordCount { get; set; }
    public string Message { get; set; } = string.Empty;
}

public sealed class ApiJsonPreviewDto
{
    public string Url { get; set; } = string.Empty;
    public string? ArrayPath { get; set; }
    public int RowCount { get; set; }
    public int ColumnCount { get; set; }
    public IReadOnlyList<string> Columns { get; set; } = [];
    public IReadOnlyList<IDictionary<string, object?>> Rows { get; set; } = [];
}
