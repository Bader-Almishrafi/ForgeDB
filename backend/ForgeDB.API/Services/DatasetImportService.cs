using System.Globalization;
using System.Text;
using System.Text.Json;
using ForgeDB.API.Clients;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Http;

namespace ForgeDB.API.Services;

public class DatasetImportService : IDatasetImportService
{
    private const int PreviewRowLimit = 50;
    private const int SampleValueLimit = 5;

    private readonly IDatasetRepository _datasetRepository;
    private readonly IPythonAnalysisClient _pythonAnalysisClient;
    private readonly ILogger<DatasetImportService> _logger;

    public DatasetImportService(
        IDatasetRepository datasetRepository,
        IPythonAnalysisClient pythonAnalysisClient,
        ILogger<DatasetImportService> logger)
    {
        _datasetRepository = datasetRepository;
        _pythonAnalysisClient = pythonAnalysisClient;
        _logger = logger;
    }

    public async Task<DatasetResponseDto> UploadDatasetAsync(int projectId, DatasetUploadDto request, CancellationToken cancellationToken = default)
    {
        if (projectId <= 0)
        {
            throw new ArgumentException("ProjectId must be greater than zero.", nameof(projectId));
        }

        if (!await _datasetRepository.ProjectExistsAsync(projectId, cancellationToken))
        {
            throw new KeyNotFoundException("Project not found.");
        }

        if (request is null)
        {
            throw new ArgumentException("Upload request is required.", nameof(request));
        }

        ValidateCsvFile(request.File);

        var sourceType = ResolveSourceType(request.SourceType);
        var sourceName = ResolveSourceName(request);
        var tableName = ResolveTableName(request);
        var importedAt = DateTime.UtcNow;
        var importResult = await ParseCsvAsync(request.File!, importedAt, cancellationToken);

        var dataset = new Dataset
        {
            ProjectId = projectId,
            TableName = tableName,
            SourceType = sourceType,
            SourceName = sourceName,
            SourceUrl = string.IsNullOrWhiteSpace(request.SourceUrl) ? null : request.SourceUrl.Trim(),
            RowCount = importResult.Rows.Count,
            ColumnCount = importResult.Columns.Count,
            MissingValuesCount = importResult.MissingValuesCount,
            DuplicateRowsCount = importResult.DuplicateRowsCount,
            Status = "Imported",
            CreatedAt = importedAt,
            Columns = importResult.Columns.ToList(),
            Rows = importResult.Rows.ToList()
        };

        await _datasetRepository.AddAsync(dataset, cancellationToken);

        return MapToResponse(dataset);
    }

    public async Task<IEnumerable<DatasetResponseDto>> GetProjectDatasetsAsync(int projectId, CancellationToken cancellationToken = default)
    {
        if (projectId <= 0)
        {
            throw new ArgumentException("ProjectId must be greater than zero.", nameof(projectId));
        }

        if (!await _datasetRepository.ProjectExistsAsync(projectId, cancellationToken))
        {
            throw new KeyNotFoundException("Project not found.");
        }

        var datasets = await _datasetRepository.GetByProjectIdAsync(projectId, cancellationToken);

        return datasets.Select(MapToResponse).ToList();
    }

    public async Task<DatasetPreviewDto> GetDatasetPreviewAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        if (datasetId <= 0)
        {
            throw new ArgumentException("DatasetId must be greater than zero.", nameof(datasetId));
        }

        var dataset = await _datasetRepository.GetByIdWithPreviewAsync(datasetId, PreviewRowLimit, cancellationToken);

        if (dataset is null)
        {
            throw new KeyNotFoundException("Dataset not found.");
        }

        return new DatasetPreviewDto
        {
            DatasetId = dataset.Id,
            TableName = dataset.TableName,
            Columns = dataset.Columns
                .OrderBy(column => column.Id)
                .Select(column => column.ColumnName)
                .ToList(),
            Rows = dataset.Rows
                .OrderBy(row => row.RowNumber)
                .ThenBy(row => row.Id)
                .Select(row => DeserializeRowData(row.RowData))
                .ToList()
        };
    }

    public async Task<DatasetAnalysisResponseDto> AnalyzeDatasetAsync(int datasetId, DatasetAnalysisRequestDto request, CancellationToken cancellationToken = default)
    {
        if (datasetId <= 0)
        {
            throw new ArgumentException("DatasetId must be greater than zero.", nameof(datasetId));
        }

        var dataset = await _datasetRepository.GetByIdWithRowsAndColumnsAsync(datasetId, cancellationToken);

        if (dataset is null)
        {
            throw new KeyNotFoundException("Dataset not found.");
        }

        var analyzedAt = DateTime.UtcNow;
        var analysis = await TryAnalyzeWithPythonAsync(dataset, analyzedAt, cancellationToken)
            ?? DatasetAnalysisBuilder.Build(dataset, analyzedAt);

        await _datasetRepository.SaveAnalysisResultAsync(
            datasetId,
            analysis.AnalysisResultJson,
            analysis.Analysis.AnalysisResult.MissingValuesCount,
            analysis.Analysis.AnalysisResult.DuplicateRowsCount,
            analyzedAt,
            cancellationToken);

        return analysis.Analysis;
    }

    public Task<bool> DeleteDatasetAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        if (datasetId <= 0)
        {
            throw new ArgumentException("DatasetId must be greater than zero.", nameof(datasetId));
        }

        return _datasetRepository.DeleteAsync(datasetId, cancellationToken);
    }

    public async Task<DatasetResponseDto?> ReplaceDatasetAsync(int datasetId, DatasetUploadDto request, CancellationToken cancellationToken = default)
    {
        if (datasetId <= 0)
        {
            throw new ArgumentException("DatasetId must be greater than zero.", nameof(datasetId));
        }

        if (request is null)
        {
            throw new ArgumentException("Replace request is required.", nameof(request));
        }

        ValidateCsvFile(request.File);

        var sourceName = ResolveSourceName(request);
        var importedAt = DateTime.UtcNow;
        var importResult = await ParseCsvAsync(request.File!, importedAt, cancellationToken);

        var dataset = await _datasetRepository.ReplaceContentAsync(
            datasetId,
            "csv",
            sourceName,
            string.IsNullOrWhiteSpace(request.SourceUrl) ? null : request.SourceUrl.Trim(),
            importResult.Columns,
            importResult.Rows,
            importResult.MissingValuesCount,
            importResult.DuplicateRowsCount,
            cancellationToken);

        return dataset is null ? null : MapToResponse(dataset);
    }

    public async Task<DatasetAnalysisResponseDto> GetDatasetAnalysisAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        if (datasetId <= 0)
        {
            throw new ArgumentException("DatasetId must be greater than zero.", nameof(datasetId));
        }

        var dataset = await _datasetRepository.GetByIdWithRowsAndColumnsAsync(datasetId, cancellationToken);

        if (dataset is null)
        {
            throw new KeyNotFoundException("Dataset not found.");
        }

        return DatasetAnalysisBuilder.Build(dataset, dataset.AnalyzedAt).Analysis;
    }

    private async Task<DatasetAnalysisBuilder.DatasetAnalysisComputation?> TryAnalyzeWithPythonAsync(
        Dataset dataset,
        DateTime analyzedAt,
        CancellationToken cancellationToken)
    {
        try
        {
            var pythonRequest = BuildPythonAnalysisRequest(dataset);
            var pythonAnalysis = await _pythonAnalysisClient.AnalyzeDatasetAsync(pythonRequest, cancellationToken);

            _logger.LogInformation(
                "Python analysis service completed analysis for dataset {DatasetId}.",
                dataset.Id);

            return DatasetAnalysisBuilder.BuildFromPython(dataset, pythonAnalysis, analyzedAt);
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(
                exception,
                "Python analysis service timed out while analyzing dataset {DatasetId}. Falling back to .NET analysis.",
                dataset.Id);

            return null;
        }
        catch (Exception exception) when (IsPythonAnalysisFailure(exception) && !cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(
                exception,
                "Python analysis service failed while analyzing dataset {DatasetId}. Falling back to .NET analysis.",
                dataset.Id);

            return null;
        }
    }

    private static bool IsPythonAnalysisFailure(Exception exception)
    {
        return exception is HttpRequestException
            or JsonException
            or InvalidOperationException
            or NotSupportedException;
    }

    private static PythonAnalysisRequestDto BuildPythonAnalysisRequest(Dataset dataset)
    {
        return new PythonAnalysisRequestDto
        {
            DatasetId = dataset.Id,
            TableName = dataset.TableName,
            Columns = dataset.Columns
                .OrderBy(column => column.Id)
                .Select(column => new PythonAnalysisColumnRequestDto
                {
                    Name = column.ColumnName,
                    DataType = string.IsNullOrWhiteSpace(column.DetectedDataType)
                        ? null
                        : column.DetectedDataType.Trim().ToLowerInvariant()
                })
                .ToList(),
            Rows = dataset.Rows
                .OrderBy(row => row.RowNumber)
                .ThenBy(row => row.Id)
                .Select(row => DeserializeRowData(row.RowData))
                .ToList()
        };
    }

    private static void ValidateCsvFile(IFormFile? file)
    {
        if (file is null)
        {
            throw new ArgumentException("CSV file is required.");
        }

        if (file.Length == 0)
        {
            throw new ArgumentException("Uploaded CSV file is empty.");
        }

        var extension = Path.GetExtension(file.FileName);
        if (!string.Equals(extension, ".csv", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Only CSV files with a .csv extension are supported.");
        }
    }

    private static string ResolveSourceType(string? sourceType)
    {
        var normalizedSourceType = string.IsNullOrWhiteSpace(sourceType)
            ? "csv"
            : sourceType.Trim().ToLowerInvariant();

        if (!string.Equals(normalizedSourceType, "csv", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Only CSV sourceType is supported.");
        }

        return "csv";
    }

    private static string? ResolveSourceName(DatasetUploadDto request)
    {
        if (!string.IsNullOrWhiteSpace(request.SourceName))
        {
            return request.SourceName.Trim();
        }

        return string.IsNullOrWhiteSpace(request.File?.FileName)
            ? null
            : Path.GetFileName(request.File.FileName);
    }

    private static string ResolveTableName(DatasetUploadDto request)
    {
        if (!string.IsNullOrWhiteSpace(request.TableName))
        {
            return request.TableName.Trim();
        }

        var fileName = Path.GetFileNameWithoutExtension(request.File?.FileName);

        return string.IsNullOrWhiteSpace(fileName) ? "dataset" : fileName.Trim();
    }

    private static async Task<CsvImportResult> ParseCsvAsync(IFormFile file, DateTime importedAt, CancellationToken cancellationToken)
    {
        await using var stream = file.OpenReadStream();
        using var reader = new StreamReader(stream);

        string? headerLine = null;
        var lineNumber = 0;

        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            lineNumber++;

            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            headerLine = line;
            break;
        }

        if (headerLine is null)
        {
            throw new ArgumentException("CSV file must contain a header row.");
        }

        var headers = ParseHeaders(headerLine);
        var columnStats = headers.Select(header => new ColumnImportStats(header)).ToList();
        var rows = new List<DatasetRow>();
        var seenRows = new HashSet<string>(StringComparer.Ordinal);
        var duplicateRowsCount = 0;
        var rowNumber = 0;

        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            lineNumber++;

            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var values = ParseCsvLine(line);
            if (values.Count != headers.Count)
            {
                throw new ArgumentException(
                    $"CSV row {lineNumber} has {values.Count} values, but the header has {headers.Count} columns.");
            }

            rowNumber++;

            var rowData = new Dictionary<string, string?>(StringComparer.Ordinal);
            for (var index = 0; index < headers.Count; index++)
            {
                var value = values[index];
                var normalizedValue = string.IsNullOrWhiteSpace(value) ? null : value;

                columnStats[index].Observe(normalizedValue);
                rowData[headers[index]] = normalizedValue;
            }

            var rowJson = JsonSerializer.Serialize(rowData);
            if (!seenRows.Add(rowJson))
            {
                duplicateRowsCount++;
            }

            rows.Add(new DatasetRow
            {
                RowNumber = rowNumber,
                RowData = rowJson,
                CreatedAt = importedAt
            });
        }

        var columns = columnStats
            .Select(stat => new DatasetColumn
            {
                ColumnName = stat.ColumnName,
                DetectedDataType = stat.DetectedDataType,
                MissingValuesCount = stat.MissingValuesCount,
                UniqueValuesCount = stat.UniqueValuesCount,
                IsNullable = stat.MissingValuesCount > 0,
                SampleValues = JsonSerializer.Serialize(stat.SampleValues)
            })
            .ToList();

        return new CsvImportResult(
            columns,
            rows,
            columnStats.Sum(stat => stat.MissingValuesCount),
            duplicateRowsCount);
    }

    private static IReadOnlyList<string> ParseHeaders(string headerLine)
    {
        var headers = ParseCsvLine(headerLine)
            .Select((header, index) => index == 0 ? header.TrimStart('\uFEFF').Trim() : header.Trim())
            .ToList();

        if (headers.Count == 0)
        {
            throw new ArgumentException("CSV file must contain at least one header.");
        }

        for (var index = 0; index < headers.Count; index++)
        {
            if (string.IsNullOrWhiteSpace(headers[index]))
            {
                throw new ArgumentException($"CSV header at position {index + 1} is empty.");
            }
        }

        var seenHeaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var header in headers)
        {
            if (!seenHeaders.Add(header))
            {
                throw new ArgumentException($"CSV header '{header}' is duplicated.");
            }
        }

        return headers;
    }

    private static IReadOnlyList<string> ParseCsvLine(string line)
    {
        var values = new List<string>();
        var currentValue = new StringBuilder();
        var inQuotes = false;

        for (var index = 0; index < line.Length; index++)
        {
            var character = line[index];

            if (character == '"')
            {
                if (inQuotes && index + 1 < line.Length && line[index + 1] == '"')
                {
                    currentValue.Append(character);
                    index++;
                    continue;
                }

                inQuotes = !inQuotes;
                continue;
            }

            if (character == ',' && !inQuotes)
            {
                values.Add(currentValue.ToString().Trim());
                currentValue.Clear();
                continue;
            }

            currentValue.Append(character);
        }

        if (inQuotes)
        {
            throw new ArgumentException("CSV contains an unterminated quoted value.");
        }

        values.Add(currentValue.ToString().Trim());

        return values;
    }

    private static IDictionary<string, object?> DeserializeRowData(string rowData)
    {
        var values = JsonSerializer.Deserialize<Dictionary<string, string?>>(rowData)
            ?? new Dictionary<string, string?>(StringComparer.Ordinal);

        return values.ToDictionary(
            value => value.Key,
            value => (object?)value.Value,
            StringComparer.Ordinal);
    }

    private static DatasetResponseDto MapToResponse(Dataset dataset)
    {
        return new DatasetResponseDto
        {
            Id = dataset.Id,
            ProjectId = dataset.ProjectId,
            TableName = dataset.TableName,
            SourceType = dataset.SourceType,
            SourceName = dataset.SourceName,
            RowCount = dataset.RowCount,
            ColumnCount = dataset.ColumnCount,
            MissingValuesCount = dataset.MissingValuesCount,
            DuplicateRowsCount = dataset.DuplicateRowsCount,
            Status = dataset.Status,
            CreatedAt = dataset.CreatedAt
        };
    }

    private sealed record CsvImportResult(
        IReadOnlyList<DatasetColumn> Columns,
        IReadOnlyList<DatasetRow> Rows,
        int MissingValuesCount,
        int DuplicateRowsCount);

    private sealed class ColumnImportStats
    {
        private readonly HashSet<string> _uniqueValues = new(StringComparer.Ordinal);
        private readonly List<string> _sampleValues = new();
        private bool _hasValues;
        private bool _allIntegers = true;
        private bool _allDecimals = true;
        private bool _allBooleans = true;
        private bool _allDateTimes = true;

        public ColumnImportStats(string columnName)
        {
            ColumnName = columnName;
        }

        public string ColumnName { get; }
        public int MissingValuesCount { get; private set; }
        public int UniqueValuesCount => _uniqueValues.Count;
        public IReadOnlyList<string> SampleValues => _sampleValues;

        public string DetectedDataType
        {
            get
            {
                if (!_hasValues)
                {
                    return "string";
                }

                if (_allBooleans)
                {
                    return "boolean";
                }

                if (_allIntegers)
                {
                    return "integer";
                }

                if (_allDecimals)
                {
                    return "decimal";
                }

                return _allDateTimes ? "datetime" : "string";
            }
        }

        public void Observe(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                MissingValuesCount++;
                return;
            }

            _hasValues = true;
            _uniqueValues.Add(value);

            if (_sampleValues.Count < SampleValueLimit && !_sampleValues.Contains(value, StringComparer.Ordinal))
            {
                _sampleValues.Add(value);
            }

            _allIntegers = _allIntegers
                && int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _);
            _allDecimals = _allDecimals
                && decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out _);
            _allBooleans = _allBooleans
                && bool.TryParse(value, out _);
            _allDateTimes = _allDateTimes
                && DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out _);
        }
    }
}
