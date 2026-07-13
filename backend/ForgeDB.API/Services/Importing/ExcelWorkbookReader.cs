using System.Globalization;
using System.Text;
using ExcelDataReader;
using ExcelDataReader.Exceptions;
using Microsoft.AspNetCore.Http;

namespace ForgeDB.API.Services.Importing;

public sealed class ExcelWorkbookReader : IExcelWorkbookReader
{
    public const long MaximumFileBytes = 10 * 1024 * 1024;
    public const int MaximumRows = 100_000;
    public const int MaximumColumns = 500;
    public const long MaximumCells = 2_000_000;

    static ExcelWorkbookReader()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    public async Task<ExcelWorkbookData> ReadAsync(
        IFormFile file,
        string? worksheetName,
        CancellationToken cancellationToken = default)
    {
        ValidateFile(file);
        var requestedSheet = NormalizeWorksheetName(worksheetName);

        try
        {
            await using var input = file.OpenReadStream();
            await using var buffered = new MemoryStream((int)Math.Min(file.Length, MaximumFileBytes));
            await input.CopyToAsync(buffered, cancellationToken);
            buffered.Position = 0;

            using var reader = ExcelReaderFactory.CreateOpenXmlReader(buffered, new ExcelReaderConfiguration
            {
                LeaveOpen = false
            });

            var worksheets = new List<string>();
            TabularImportData? selected = null;
            do
            {
                cancellationToken.ThrowIfCancellationRequested();
                var rows = ReadNonEmptyRows(reader, cancellationToken);
                if (rows.Count == 0)
                {
                    continue;
                }

                var sheetName = string.IsNullOrWhiteSpace(reader.Name) ? $"Sheet{worksheets.Count + 1}" : reader.Name;
                worksheets.Add(sheetName);
                if (requestedSheet is not null && sheetName.Equals(requestedSheet, StringComparison.OrdinalIgnoreCase))
                {
                    selected = BuildSheet(sheetName, rows);
                }
                else if (requestedSheet is null && selected is null)
                {
                    selected = BuildSheet(sheetName, rows);
                }
            }
            while (reader.NextResult());

            if (worksheets.Count == 0)
            {
                throw new ArgumentException("The Excel workbook does not contain a non-empty worksheet.");
            }

            if (requestedSheet is not null && selected is null)
            {
                throw new ArgumentException($"Worksheet '{requestedSheet}' was not found or is empty.");
            }

            if (requestedSheet is null && worksheets.Count > 1)
            {
                selected = null;
            }

            return new ExcelWorkbookData(worksheets, selected);
        }
        catch (ArgumentException)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (exception is ExcelReaderException
            or InvalidOperationException
            or NotSupportedException
            or IOException)
        {
            throw new ArgumentException(
                "The Excel workbook is corrupted, password-protected, or uses an unsupported format.",
                nameof(file),
                exception);
        }
    }

    private static void ValidateFile(IFormFile? file)
    {
        if (file is null)
        {
            throw new ArgumentException("Excel workbook is required.");
        }

        if (file.Length == 0)
        {
            throw new ArgumentException("The Excel workbook is empty.");
        }

        if (file.Length > MaximumFileBytes)
        {
            throw new ArgumentException($"The Excel workbook exceeds the {MaximumFileBytes / 1024 / 1024} MB upload limit.");
        }

        if (!Path.GetExtension(file.FileName).Equals(".xlsx", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Only Excel workbooks with a .xlsx extension are supported.");
        }
    }

    private static string? NormalizeWorksheetName(string? worksheetName)
    {
        if (string.IsNullOrWhiteSpace(worksheetName))
        {
            return null;
        }

        var normalized = worksheetName.Trim();
        if (normalized.Length > 31 || normalized.IndexOfAny(['[', ']', ':', '*', '?', '/', '\\']) >= 0)
        {
            throw new ArgumentException("Worksheet name is invalid.");
        }

        return normalized;
    }

    private static List<IReadOnlyList<string?>> ReadNonEmptyRows(IExcelDataReader reader, CancellationToken cancellationToken)
    {
        var result = new List<IReadOnlyList<string?>>();
        var readRows = 0;
        var cellCount = 0L;

        while (reader.Read())
        {
            cancellationToken.ThrowIfCancellationRequested();
            readRows++;
            if (readRows > MaximumRows + 1)
            {
                throw new ArgumentException($"Worksheet '{reader.Name}' exceeds the {MaximumRows:N0} row limit.");
            }

            var fieldCount = reader.FieldCount;
            if (fieldCount > MaximumColumns)
            {
                throw new ArgumentException($"Worksheet '{reader.Name}' exceeds the {MaximumColumns:N0} column limit.");
            }

            cellCount += fieldCount;
            if (cellCount > MaximumCells)
            {
                throw new ArgumentException($"Worksheet '{reader.Name}' exceeds the {MaximumCells:N0} cell limit.");
            }

            var values = new string?[fieldCount];
            var lastValueIndex = -1;
            for (var index = 0; index < fieldCount; index++)
            {
                values[index] = NormalizeCell(reader.GetValue(index));
                if (values[index] is not null)
                {
                    lastValueIndex = index;
                }
            }

            if (lastValueIndex >= 0)
            {
                result.Add(values.Take(lastValueIndex + 1).ToArray());
            }
        }

        return result;
    }

    private static TabularImportData BuildSheet(string sheetName, IReadOnlyList<IReadOnlyList<string?>> rawRows)
    {
        var columnCount = rawRows.Max(row => row.Count);
        if (columnCount <= 0)
        {
            throw new ArgumentException($"Worksheet '{sheetName}' does not contain a valid header row.");
        }

        var headers = NormalizeHeaders(rawRows[0], columnCount);
        var rows = new List<IReadOnlyDictionary<string, string?>>(Math.Max(0, rawRows.Count - 1));
        foreach (var rawRow in rawRows.Skip(1))
        {
            var row = new Dictionary<string, string?>(headers.Count, StringComparer.Ordinal);
            for (var index = 0; index < headers.Count; index++)
            {
                row[headers[index]] = index < rawRow.Count ? rawRow[index] : null;
            }
            rows.Add(row);
        }

        return new TabularImportData(headers, rows, sheetName);
    }

    internal static IReadOnlyList<string> NormalizeHeaders(IReadOnlyList<string?> rawHeaders, int columnCount)
    {
        var result = new List<string>(columnCount);
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < columnCount; index++)
        {
            var baseName = index < rawHeaders.Count ? rawHeaders[index]?.Trim() : null;
            if (string.IsNullOrWhiteSpace(baseName))
            {
                baseName = $"column_{index + 1}";
            }

            var candidate = baseName;
            var suffix = 2;
            while (!used.Add(candidate))
            {
                candidate = $"{baseName}_{suffix++}";
            }
            result.Add(candidate);
        }

        return result;
    }

    private static string? NormalizeCell(object? value)
    {
        if (value is null or DBNull)
        {
            return null;
        }

        var text = value switch
        {
            DateTime dateTime => dateTime.ToString("O", CultureInfo.InvariantCulture),
            DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("O", CultureInfo.InvariantCulture),
            IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
            _ => value.ToString()
        };

        return string.IsNullOrWhiteSpace(text) ? null : text;
    }
}
