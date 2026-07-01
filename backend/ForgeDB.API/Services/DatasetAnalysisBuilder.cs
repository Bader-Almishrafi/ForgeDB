using System.Globalization;
using System.Text.Json;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Services;

internal static class DatasetAnalysisBuilder
{
    private const int SampleValueLimit = 5;
    private const int MostCommonValueLimit = 5;
    private const string DuplicateRowRule = "Exact full-row match across all stored columns.";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static DatasetAnalysisComputation Build(Dataset dataset, DateTime? analyzedAt = null)
    {
        ArgumentNullException.ThrowIfNull(dataset);

        var columns = dataset.Columns
            .OrderBy(column => column.Id)
            .ToList();

        var rows = dataset.Rows
            .OrderBy(row => row.RowNumber)
            .ThenBy(row => row.Id)
            .ToList();

        if (columns.Count == 0)
        {
            throw new ArgumentException("Dataset has no columns to analyze.");
        }

        if (rows.Count == 0)
        {
            throw new ArgumentException("Dataset has no rows to analyze.");
        }

        var columnNames = columns
            .Select(column => column.ColumnName)
            .ToList();

        var rowValues = rows
            .Select(row => DeserializeRowData(row.RowData))
            .ToList();

        var columnAnalyses = columnNames
            .Select(columnName => AnalyzeColumn(columnName, rowValues))
            .ToList();

        var duplicateRowsCount = CountDuplicateRows(rowValues, columnNames);
        var missingValuesCount = columnAnalyses.Sum(column => column.MissingValuesCount);
        var typeDistribution = columnAnalyses
            .GroupBy(column => column.DetectedDataType, StringComparer.OrdinalIgnoreCase)
            .OrderBy(group => group.Key)
            .Select(group => new ColumnTypeDistributionDto
            {
                DataType = group.Key,
                Count = group.Count()
            })
            .ToList();

        var analysisResult = new DatasetAnalysisResultDto
        {
            RowCount = rows.Count,
            ColumnCount = columns.Count,
            MissingValuesCount = missingValuesCount,
            DuplicateRowsCount = duplicateRowsCount,
            DuplicateRowRule = DuplicateRowRule,
            Columns = columnAnalyses,
            ColumnTypeDistribution = typeDistribution
        };

        var chartRecommendations = BuildChartRecommendations(columnAnalyses);

        var analysisResponse = new DatasetAnalysisResponseDto
        {
            DatasetId = dataset.Id,
            TableName = dataset.TableName,
            Status = analyzedAt.HasValue ? "Analyzed" : dataset.Status,
            AnalysisResult = analysisResult,
            ChartRecommendations = chartRecommendations,
            AnalyzedAt = analyzedAt ?? dataset.AnalyzedAt
        };

        var dashboard = new DashboardResponseDto
        {
            DatasetId = dataset.Id,
            TableName = dataset.TableName,
            RowCount = rows.Count,
            ColumnCount = columns.Count,
            MissingValuesCount = missingValuesCount,
            DuplicateRowsCount = duplicateRowsCount,
            Metrics = BuildMetrics(rows.Count, columns.Count, missingValuesCount, duplicateRowsCount),
            ColumnTypeDistribution = typeDistribution,
            NumericSummaries = columnAnalyses
                .Where(column => column.NumericStats is not null)
                .Select(column => column.NumericStats!)
                .ToList(),
            TopValueSummaries = columnAnalyses
                .Where(column => column.MostCommonValues.Any())
                .Select(column => new DashboardTopValuesDto
                {
                    ColumnName = column.ColumnName,
                    Values = column.MostCommonValues
                })
                .ToList(),
            ChartRecommendations = chartRecommendations
        };

        return new DatasetAnalysisComputation(
            analysisResponse,
            dashboard,
            JsonSerializer.Serialize(analysisResult, JsonOptions));
    }

    private static ColumnAnalysisDto AnalyzeColumn(
        string columnName,
        IReadOnlyList<IDictionary<string, string?>> rows)
    {
        var values = rows
            .Select(row => row.TryGetValue(columnName, out var value) ? NormalizeMissingValue(value) : null)
            .ToList();

        var stats = new ColumnStats(columnName);
        foreach (var value in values)
        {
            stats.Observe(value);
        }

        var detectedDataType = stats.GetDetectedDataType();

        return new ColumnAnalysisDto
        {
            ColumnName = columnName,
            DetectedDataType = detectedDataType,
            MissingValuesCount = stats.MissingValuesCount,
            UniqueValuesCount = stats.UniqueValuesCount,
            IsNullable = stats.MissingValuesCount > 0,
            SampleValues = stats.SampleValues,
            NumericStats = stats.GetNumericStats(detectedDataType),
            MostCommonValues = IsNumericDataType(detectedDataType)
                ? new List<ValueFrequencyDto>()
                : stats.GetMostCommonValues()
        };
    }

    private static IReadOnlyList<DashboardMetricDto> BuildMetrics(
        int rowCount,
        int columnCount,
        int missingValuesCount,
        int duplicateRowsCount)
    {
        return new List<DashboardMetricDto>
        {
            new()
            {
                Key = "rowCount",
                Label = "Rows",
                Value = rowCount
            },
            new()
            {
                Key = "columnCount",
                Label = "Columns",
                Value = columnCount
            },
            new()
            {
                Key = "missingValues",
                Label = "Missing Values",
                Value = missingValuesCount
            },
            new()
            {
                Key = "duplicateRows",
                Label = "Duplicate Rows",
                Value = duplicateRowsCount
            }
        };
    }

    private static IReadOnlyList<ChartRecommendationDto> BuildChartRecommendations(
        IReadOnlyList<ColumnAnalysisDto> columns)
    {
        var recommendations = new List<ChartRecommendationDto>();
        var numericColumns = columns
            .Where(column => column.NumericStats is not null)
            .ToList();

        foreach (var column in numericColumns.Take(3))
        {
            recommendations.Add(new ChartRecommendationDto
            {
                ChartType = "histogram",
                Title = $"{column.ColumnName} distribution",
                Columns = new[] { column.ColumnName },
                Reason = "Numeric column with min, max, and average available."
            });
        }

        foreach (var column in columns
            .Where(column => column.NumericStats is null && column.MostCommonValues.Any())
            .Take(3))
        {
            recommendations.Add(new ChartRecommendationDto
            {
                ChartType = "bar",
                Title = $"Top {column.ColumnName} values",
                Columns = new[] { column.ColumnName },
                Reason = "Text column with repeated values that can be summarized as counts."
            });
        }

        if (numericColumns.Count >= 2)
        {
            recommendations.Add(new ChartRecommendationDto
            {
                ChartType = "scatter",
                Title = $"{numericColumns[0].ColumnName} vs {numericColumns[1].ColumnName}",
                Columns = new[] { numericColumns[0].ColumnName, numericColumns[1].ColumnName },
                Reason = "Two numeric columns are available for comparison."
            });
        }

        return recommendations;
    }

    private static int CountDuplicateRows(
        IReadOnlyList<IDictionary<string, string?>> rows,
        IReadOnlyList<string> columnNames)
    {
        var seenRows = new HashSet<string>(StringComparer.Ordinal);
        var duplicateRowsCount = 0;

        foreach (var row in rows)
        {
            var canonicalValues = columnNames
                .Select(columnName => row.TryGetValue(columnName, out var value)
                    ? NormalizeMissingValue(value)
                    : null)
                .ToList();
            var rowKey = JsonSerializer.Serialize(canonicalValues, JsonOptions);

            if (!seenRows.Add(rowKey))
            {
                duplicateRowsCount++;
            }
        }

        return duplicateRowsCount;
    }

    private static IDictionary<string, string?> DeserializeRowData(string rowData)
    {
        try
        {
            using var document = JsonDocument.Parse(rowData);

            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                throw new ArgumentException("Dataset row data must be a JSON object.");
            }

            var values = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var property in document.RootElement.EnumerateObject())
            {
                values[property.Name] = ConvertJsonElementToString(property.Value);
            }

            return values;
        }
        catch (JsonException exception)
        {
            throw new ArgumentException("Dataset row data contains invalid JSON.", exception);
        }
    }

    private static string? ConvertJsonElementToString(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.Undefined => null,
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number => element.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => element.GetRawText()
        };
    }

    private static string? NormalizeMissingValue(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static bool IsNumericDataType(string dataType)
    {
        return string.Equals(dataType, "integer", StringComparison.OrdinalIgnoreCase)
            || string.Equals(dataType, "decimal", StringComparison.OrdinalIgnoreCase);
    }

    internal sealed record DatasetAnalysisComputation(
        DatasetAnalysisResponseDto Analysis,
        DashboardResponseDto Dashboard,
        string AnalysisResultJson);

    private sealed class ColumnStats
    {
        private readonly Dictionary<string, int> _valueCounts = new(StringComparer.Ordinal);
        private readonly List<string> _sampleValues = new();
        private readonly List<decimal> _numericValues = new();

        private bool _hasValues;
        private bool _allIntegers = true;
        private bool _allDecimals = true;
        private bool _allBooleans = true;
        private bool _allDateTimes = true;

        public ColumnStats(string columnName)
        {
            ColumnName = columnName;
        }

        public string ColumnName { get; }
        public int MissingValuesCount { get; private set; }
        public int UniqueValuesCount => _valueCounts.Count;
        public IReadOnlyList<string> SampleValues => _sampleValues;

        public void Observe(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                MissingValuesCount++;
                return;
            }

            _hasValues = true;

            if (_valueCounts.TryGetValue(value, out var count))
            {
                _valueCounts[value] = count + 1;
            }
            else
            {
                _valueCounts[value] = 1;
            }

            if (_sampleValues.Count < SampleValueLimit && !_sampleValues.Contains(value, StringComparer.Ordinal))
            {
                _sampleValues.Add(value);
            }

            var isInteger = long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _);
            var isDecimal = decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var decimalValue);

            _allIntegers = _allIntegers && isInteger;
            _allDecimals = _allDecimals && isDecimal;
            _allBooleans = _allBooleans && bool.TryParse(value, out _);
            _allDateTimes = _allDateTimes
                && DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out _);

            if (isDecimal)
            {
                _numericValues.Add(decimalValue);
            }
        }

        public string GetDetectedDataType()
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

        public NumericColumnStatsDto? GetNumericStats(string detectedDataType)
        {
            if (!IsNumericDataType(detectedDataType) || _numericValues.Count == 0)
            {
                return null;
            }

            return new NumericColumnStatsDto
            {
                ColumnName = ColumnName,
                Min = _numericValues.Min(),
                Max = _numericValues.Max(),
                Average = Math.Round(_numericValues.Average(), 4),
                Count = _numericValues.Count
            };
        }

        public IReadOnlyList<ValueFrequencyDto> GetMostCommonValues()
        {
            return _valueCounts
                .OrderByDescending(pair => pair.Value)
                .ThenBy(pair => pair.Key, StringComparer.Ordinal)
                .Take(MostCommonValueLimit)
                .Select(pair => new ValueFrequencyDto
                {
                    Value = pair.Key,
                    Count = pair.Value
                })
                .ToList();
        }
    }
}
