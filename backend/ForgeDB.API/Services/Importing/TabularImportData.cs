namespace ForgeDB.API.Services.Importing;

public sealed record TabularImportData(
    IReadOnlyList<string> Columns,
    IReadOnlyList<IReadOnlyDictionary<string, string?>> Rows,
    string? SelectionName = null);

public sealed record ExcelWorkbookData(
    IReadOnlyList<string> Worksheets,
    TabularImportData? SelectedSheet);
