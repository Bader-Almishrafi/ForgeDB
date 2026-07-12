using System.Text.Json;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Services;

internal static class CleaningSnapshotSerializer
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string SerializeColumns(IEnumerable<CleaningColumnSnapshotDto> columns) =>
        JsonSerializer.Serialize(columns, JsonOptions);

    public static string SerializeRows(IEnumerable<Dictionary<string, object?>> rows) =>
        JsonSerializer.Serialize(rows, JsonOptions);

    public static List<CleaningColumnSnapshotDto> DeserializeColumns(string json) =>
        JsonSerializer.Deserialize<List<CleaningColumnSnapshotDto>>(json, JsonOptions) ?? new();

    public static List<Dictionary<string, object?>> DeserializeRows(string json) =>
        JsonSerializer.Deserialize<List<Dictionary<string, object?>>>(json, JsonOptions) ?? new();

    public static List<CleaningColumnSnapshotDto> FromDatasetColumns(IEnumerable<DatasetColumn> columns) =>
        columns.OrderBy(column => column.Id).Select(column => new CleaningColumnSnapshotDto
        {
            Name = column.ColumnName,
            DataType = string.IsNullOrWhiteSpace(column.DetectedDataType) ? "string" : column.DetectedDataType
        }).ToList();

    public static List<Dictionary<string, object?>> FromDatasetRows(IEnumerable<DatasetRow> rows) =>
        rows.OrderBy(row => row.RowNumber).ThenBy(row => row.Id).Select(row =>
        {
            try
            {
                return JsonSerializer.Deserialize<Dictionary<string, object?>>(row.RowData, JsonOptions) ?? new();
            }
            catch (JsonException exception)
            {
                throw new InvalidOperationException($"Dataset row {row.RowNumber} contains invalid JSON.", exception);
            }
        }).ToList();
}
