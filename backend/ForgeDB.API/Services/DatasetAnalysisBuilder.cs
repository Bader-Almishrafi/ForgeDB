using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
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
        var analysisResult = new DatasetAnalysisResultDto
        {
            RowCount = rows.Count,
            ColumnCount = columns.Count,
            MissingValuesCount = missingValuesCount,
            DuplicateRowsCount = duplicateRowsCount,
            DuplicateRowRule = DuplicateRowRule,
            Columns = columnAnalyses,
            ColumnTypeDistribution = BuildColumnTypeDistribution(columnAnalyses)
        };

        var chartRecommendations = BuildChartRecommendations(columnAnalyses);

        return BuildComputation(dataset, analysisResult, chartRecommendations, analyzedAt);
    }

    public static DatasetAnalysisComputation BuildFromPython(
        Dataset dataset,
        PythonAnalysisResponseDto pythonAnalysis,
        DateTime analyzedAt)
    {
        ArgumentNullException.ThrowIfNull(dataset);
        ArgumentNullException.ThrowIfNull(pythonAnalysis);

        var baseline = Build(dataset, analyzedAt);
        var baselineColumns = baseline.Analysis.AnalysisResult.Columns
            .GroupBy(column => column.ColumnName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        var pythonColumns = pythonAnalysis.Columns
            .Where(column => !string.IsNullOrWhiteSpace(column.Name))
            .GroupBy(column => column.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        var columns = dataset.Columns
            .OrderBy(column => column.Id)
            .Select(column => pythonColumns.TryGetValue(column.ColumnName, out var pythonColumn)
                ? MapPythonColumn(pythonColumn, pythonAnalysis.RowCount, baselineColumns.GetValueOrDefault(column.ColumnName))
                : baselineColumns.GetValueOrDefault(column.ColumnName))
            .Where(column => column is not null)
            .Select(column => column!)
            .ToList();

        if (columns.Count == 0)
        {
            columns = baseline.Analysis.AnalysisResult.Columns.ToList();
        }

        var chartRecommendations = MapPythonChartRecommendations(pythonAnalysis.ChartRecommendations);
        if (chartRecommendations.Count == 0)
        {
            chartRecommendations = baseline.Analysis.ChartRecommendations.ToList();
        }

        var analysisResult = new DatasetAnalysisResultDto
        {
            RowCount = pythonAnalysis.RowCount,
            ColumnCount = pythonAnalysis.ColumnCount,
            MissingValuesCount = pythonAnalysis.MissingValuesCount,
            DuplicateRowsCount = pythonAnalysis.DuplicateRowsCount,
            DuplicateRowRule = DuplicateRowRule,
            Columns = columns,
            ColumnTypeDistribution = BuildColumnTypeDistribution(columns)
        };

        return BuildComputation(dataset, analysisResult, chartRecommendations, analyzedAt);
    }

    private static DatasetAnalysisComputation BuildComputation(
        Dataset dataset,
        DatasetAnalysisResultDto analysisResult,
        IReadOnlyList<ChartRecommendationDto> chartRecommendations,
        DateTime? analyzedAt)
    {
        var columnAnalyses = analysisResult.Columns.ToList();
        var typeDistribution = analysisResult.ColumnTypeDistribution.ToList();
        var enrichedChartRecommendations = AddPreviewData(chartRecommendations, columnAnalyses, dataset);
        var keyCandidates = BuildKeyCandidates(columnAnalyses, analysisResult.RowCount);
        var dateRanges = BuildDateRanges(columnAnalyses, dataset);
        var relationshipHints = BuildRelationshipCandidateHints(columnAnalyses, analysisResult.RowCount);

        analysisResult.Columns = columnAnalyses;
        analysisResult.ColumnTypeDistribution = typeDistribution;

        var analysisResponse = new DatasetAnalysisResponseDto
        {
            DatasetId = dataset.Id,
            TableName = dataset.TableName,
            Status = analyzedAt.HasValue ? "Analyzed" : dataset.Status,
            AnalysisResult = analysisResult,
            ChartRecommendations = enrichedChartRecommendations,
            KeyCandidates = keyCandidates,
            DateRanges = dateRanges,
            RelationshipCandidateHints = relationshipHints,
            AnalyzedAt = analyzedAt ?? dataset.AnalyzedAt
        };

        var dashboard = new DashboardResponseDto
        {
            DatasetId = dataset.Id,
            TableName = dataset.TableName,
            RowCount = analysisResult.RowCount,
            ColumnCount = analysisResult.ColumnCount,
            MissingValuesCount = analysisResult.MissingValuesCount,
            DuplicateRowsCount = analysisResult.DuplicateRowsCount,
            Metrics = BuildMetrics(
                analysisResult.RowCount,
                analysisResult.ColumnCount,
                analysisResult.MissingValuesCount,
                analysisResult.DuplicateRowsCount),
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
            ChartRecommendations = enrichedChartRecommendations
        };

        return new DatasetAnalysisComputation(
            analysisResponse,
            dashboard,
            JsonSerializer.Serialize(analysisResult, JsonOptions));
    }

    private static ColumnAnalysisDto MapPythonColumn(
        PythonAnalysisColumnProfileDto pythonColumn,
        int rowCount,
        ColumnAnalysisDto? fallback)
    {
        var detectedType = NormalizeDataType(pythonColumn.DetectedType, fallback?.DetectedDataType);
        var sampleValues = pythonColumn.SampleValues
            .Select(ConvertValueToString)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Take(SampleValueLimit)
            .ToList();

        var topValues = pythonColumn.TopValues
            .Where(value => value.Count > 0)
            .Select(value => new ValueFrequencyDto
            {
                Value = ConvertValueToString(value.Value),
                Count = value.Count
            })
            .ToList();

        return new ColumnAnalysisDto
        {
            ColumnName = pythonColumn.Name,
            DetectedDataType = detectedType,
            MissingValuesCount = pythonColumn.MissingCount,
            UniqueValuesCount = pythonColumn.UniqueCount,
            IsNullable = pythonColumn.MissingCount > 0,
            SampleValues = sampleValues.Count > 0 ? sampleValues : fallback?.SampleValues ?? new List<string>(),
            NumericStats = pythonColumn.NumericStats is null
                ? fallback?.NumericStats
                : new NumericColumnStatsDto
                {
                    ColumnName = pythonColumn.Name,
                    Min = pythonColumn.NumericStats.Min,
                    Max = pythonColumn.NumericStats.Max,
                    Average = Math.Round(pythonColumn.NumericStats.Average, 4),
                    Count = Math.Max(0, rowCount - pythonColumn.MissingCount)
                },
            MostCommonValues = topValues.Count > 0 ? topValues : fallback?.MostCommonValues ?? new List<ValueFrequencyDto>()
        };
    }

    private static IReadOnlyList<ChartRecommendationDto> MapPythonChartRecommendations(
        IEnumerable<PythonChartRecommendationDto> recommendations)
    {
        return recommendations
            .Where(recommendation => !string.IsNullOrWhiteSpace(recommendation.ChartType)
                && !string.IsNullOrWhiteSpace(recommendation.XColumn))
            .Select(recommendation =>
            {
                var columns = new List<string> { recommendation.XColumn.Trim() };
                if (!string.IsNullOrWhiteSpace(recommendation.YColumn)
                    && !columns.Contains(recommendation.YColumn, StringComparer.OrdinalIgnoreCase))
                {
                    columns.Add(recommendation.YColumn.Trim());
                }

                return new ChartRecommendationDto
                {
                    ChartType = recommendation.ChartType.Trim(),
                    Title = string.IsNullOrWhiteSpace(recommendation.Title)
                        ? $"{recommendation.ChartType.Trim()} chart"
                        : recommendation.Title.Trim(),
                    Columns = columns,
                    XColumn = recommendation.XColumn.Trim(),
                    YColumn = string.IsNullOrWhiteSpace(recommendation.YColumn)
                        ? null
                        : recommendation.YColumn.Trim(),
                    Reason = string.IsNullOrWhiteSpace(recommendation.Reason)
                        ? null
                        : recommendation.Reason.Trim(),
                    Usefulness = "Suggested"
                };
            })
            .ToList();
    }

    private static string NormalizeDataType(string? detectedType, string? fallback)
    {
        var normalized = string.IsNullOrWhiteSpace(detectedType)
            ? fallback
            : detectedType.Trim();

        return string.IsNullOrWhiteSpace(normalized)
            ? "string"
            : normalized.Trim().ToLowerInvariant();
    }

    private static string? ConvertValueToString(object? value)
    {
        return value switch
        {
            null => null,
            JsonElement element => ConvertJsonElementToString(element),
            IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
            _ => value.ToString()
        };
    }

    private static IReadOnlyList<ColumnTypeDistributionDto> BuildColumnTypeDistribution(
        IReadOnlyList<ColumnAnalysisDto> columns)
    {
        return columns
            .GroupBy(column => column.DetectedDataType, StringComparer.OrdinalIgnoreCase)
            .OrderBy(group => group.Key)
            .Select(group => new ColumnTypeDistributionDto
            {
                DataType = group.Key,
                Count = group.Count()
            })
            .ToList();
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
            .OrderBy(column => IsKeyLikeColumn(column.ColumnName))
            .ThenBy(column => column.ColumnName, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var dateColumns = columns
            .Where(column => IsDateDataType(column.DetectedDataType))
            .OrderBy(column => column.ColumnName, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var categoricalColumns = columns
            .Where(column => column.NumericStats is null
                && !IsDateDataType(column.DetectedDataType)
                && !IsKeyLikeColumn(column.ColumnName)
                && column.MostCommonValues.Any())
            .OrderByDescending(column => column.MostCommonValues.Any(value => value.Count > 1))
            .ThenBy(column => column.ColumnName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var primaryDate = dateColumns.FirstOrDefault();
        var primaryMeasure = numericColumns.FirstOrDefault(column => !IsKeyLikeColumn(column.ColumnName))
            ?? numericColumns.FirstOrDefault();

        if (primaryDate is not null && primaryMeasure is not null)
        {
            recommendations.Add(new ChartRecommendationDto
            {
                ChartType = "line",
                Title = $"{ToTitle(primaryMeasure.ColumnName)} over {primaryDate.ColumnName}",
                Columns = new[] { primaryDate.ColumnName, primaryMeasure.ColumnName },
                XColumn = primaryDate.ColumnName,
                YColumn = primaryMeasure.ColumnName,
                Reason = $"{primaryDate.ColumnName} is a date column and {primaryMeasure.ColumnName} is numeric.",
                Usefulness = "High"
            });
        }

        foreach (var column in categoricalColumns.Take(3))
        {
            var hasRepeatedValues = column.MostCommonValues.Any(value => value.Count > 1);
            recommendations.Add(new ChartRecommendationDto
            {
                ChartType = "bar",
                Title = hasRepeatedValues
                    ? $"Top {ToTitle(column.ColumnName)} values"
                    : $"Records by {column.ColumnName}",
                Columns = new[] { column.ColumnName },
                XColumn = column.ColumnName,
                YColumn = "count",
                Reason = hasRepeatedValues
                    ? $"{column.ColumnName} is a categorical column with repeated values."
                    : $"{column.ColumnName} is a categorical column that can be summarized as record counts.",
                Usefulness = hasRepeatedValues ? "High" : "Medium"
            });
        }

        foreach (var column in numericColumns
            .Where(column => !IsKeyLikeColumn(column.ColumnName))
            .Take(3))
        {
            recommendations.Add(new ChartRecommendationDto
            {
                ChartType = "histogram",
                Title = $"Distribution of {column.ColumnName}",
                Columns = new[] { column.ColumnName },
                XColumn = column.ColumnName,
                Reason = $"{column.ColumnName} is numeric and useful for distribution analysis.",
                Usefulness = "High"
            });
        }

        if (recommendations.Count == 0 && numericColumns.Count >= 2)
        {
            recommendations.Add(new ChartRecommendationDto
            {
                ChartType = "scatter",
                Title = $"{numericColumns[0].ColumnName} vs {numericColumns[1].ColumnName}",
                Columns = new[] { numericColumns[0].ColumnName, numericColumns[1].ColumnName },
                XColumn = numericColumns[0].ColumnName,
                YColumn = numericColumns[1].ColumnName,
                Reason = "Two numeric columns are available for comparison.",
                Usefulness = "Medium"
            });
        }

        return recommendations
            .GroupBy(recommendation => $"{recommendation.ChartType}:{recommendation.Title}", StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Take(6)
            .ToList();
    }

    private static IReadOnlyList<ChartRecommendationDto> AddPreviewData(
        IReadOnlyList<ChartRecommendationDto> recommendations,
        IReadOnlyList<ColumnAnalysisDto> columns,
        Dataset dataset)
    {
        var columnMap = columns.ToDictionary(column => column.ColumnName, StringComparer.OrdinalIgnoreCase);
        var rows = dataset.Rows
            .OrderBy(row => row.RowNumber)
            .ThenBy(row => row.Id)
            .Select(row => DeserializeRowData(row.RowData))
            .ToList();

        return recommendations.Select(recommendation =>
        {
            var xColumn = recommendation.XColumn ?? recommendation.Columns.FirstOrDefault();
            var yColumn = recommendation.YColumn;
            var previewData = new List<ChartPreviewPointDto>();

            if (!string.IsNullOrWhiteSpace(xColumn))
            {
                if (recommendation.ChartType.Contains("line", StringComparison.OrdinalIgnoreCase)
                    && !string.IsNullOrWhiteSpace(yColumn))
                {
                    previewData = BuildTrendPreview(rows, xColumn, yColumn);
                }
                else if (recommendation.ChartType.Contains("histogram", StringComparison.OrdinalIgnoreCase))
                {
                    previewData = BuildHistogramPreview(rows, xColumn);
                }
                else if (recommendation.ChartType.Contains("bar", StringComparison.OrdinalIgnoreCase))
                {
                    previewData = BuildCategoricalPreview(rows, xColumn);
                }
            }

            if (previewData.Count == 0
                && !string.IsNullOrWhiteSpace(xColumn)
                && columnMap.TryGetValue(xColumn, out var xColumnProfile)
                && xColumnProfile.MostCommonValues.Any())
            {
                previewData = xColumnProfile.MostCommonValues
                    .Take(5)
                    .Select(value => new ChartPreviewPointDto
                    {
                        Label = string.IsNullOrWhiteSpace(value.Value) ? "(blank)" : value.Value,
                        Value = value.Count
                    })
                    .ToList();
            }
            else
            {
                var numericColumn = !string.IsNullOrWhiteSpace(yColumn) && columnMap.TryGetValue(yColumn, out var yColumnProfile)
                    ? yColumnProfile
                    : !string.IsNullOrWhiteSpace(xColumn) && columnMap.TryGetValue(xColumn, out var fallbackProfile)
                        ? fallbackProfile
                        : null;

                if (numericColumn?.NumericStats is not null)
                {
                    previewData = new List<ChartPreviewPointDto>
                    {
                        new() { Label = "Min", Value = numericColumn.NumericStats.Min },
                        new() { Label = "Avg", Value = numericColumn.NumericStats.Average },
                        new() { Label = "Max", Value = numericColumn.NumericStats.Max }
                    };
                }
            }

            recommendation.PreviewData = previewData;
            return recommendation;
        }).ToList();
    }

    private static List<ChartPreviewPointDto> BuildTrendPreview(
        IReadOnlyList<IDictionary<string, string?>> rows,
        string xColumn,
        string yColumn)
    {
        return rows
            .Select(row =>
            {
                var xValue = TryGetValue(row, xColumn);
                var yValue = TryGetValue(row, yColumn);
                if (string.IsNullOrWhiteSpace(xValue) || !TryParseDecimal(yValue, out var numericValue))
                {
                    return null;
                }

                var parsedDate = DateTimeOffset.TryParse(xValue, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date)
                    ? date
                    : (DateTimeOffset?)null;

                return new
                {
                    Label = parsedDate.HasValue
                        ? parsedDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                        : xValue.Trim(),
                    SortDate = parsedDate,
                    Value = numericValue
                };
            })
            .Where(point => point is not null)
            .Select(point => point!)
            .GroupBy(point => point.Label, StringComparer.OrdinalIgnoreCase)
            .Select(group => new
            {
                Label = group.Key,
                SortDate = group.Select(point => point.SortDate).Where(date => date.HasValue).Min(),
                Value = group.Sum(point => point.Value)
            })
            .OrderBy(point => point.SortDate ?? DateTimeOffset.MaxValue)
            .ThenBy(point => point.Label, StringComparer.OrdinalIgnoreCase)
            .Take(8)
            .Select(point => new ChartPreviewPointDto
            {
                Label = point.Label,
                Value = Math.Round(point.Value, 4)
            })
            .ToList();
    }

    private static List<ChartPreviewPointDto> BuildCategoricalPreview(
        IReadOnlyList<IDictionary<string, string?>> rows,
        string columnName)
    {
        return rows
            .Select(row => TryGetValue(row, columnName))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!.Trim())
            .GroupBy(value => value, StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(group => group.Count())
            .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .Take(5)
            .Select(group => new ChartPreviewPointDto
            {
                Label = group.Key,
                Value = group.Count()
            })
            .ToList();
    }

    private static List<ChartPreviewPointDto> BuildHistogramPreview(
        IReadOnlyList<IDictionary<string, string?>> rows,
        string columnName)
    {
        var values = rows
            .Select(row => TryGetValue(row, columnName))
            .Where(value => TryParseDecimal(value, out _))
            .Select(value =>
            {
                TryParseDecimal(value, out var parsed);
                return parsed;
            })
            .OrderBy(value => value)
            .ToList();

        if (values.Count == 0)
        {
            return new List<ChartPreviewPointDto>();
        }

        var distinctValues = values.Distinct().ToList();
        if (distinctValues.Count <= 5)
        {
            return values
                .GroupBy(value => value)
                .OrderBy(group => group.Key)
                .Select(group => new ChartPreviewPointDto
                {
                    Label = group.Key.ToString("0.####", CultureInfo.InvariantCulture),
                    Value = group.Count()
                })
                .ToList();
        }

        var min = values.First();
        var max = values.Last();
        var bucketCount = 5;
        var width = (max - min) / bucketCount;
        if (width <= 0)
        {
            return new List<ChartPreviewPointDto>
            {
                new() { Label = min.ToString("0.####", CultureInfo.InvariantCulture), Value = values.Count }
            };
        }

        var preview = new List<ChartPreviewPointDto>();
        for (var index = 0; index < bucketCount; index++)
        {
            var lower = min + width * index;
            var upper = index == bucketCount - 1 ? max : lower + width;
            var count = values.Count(value => value >= lower && (index == bucketCount - 1 ? value <= upper : value < upper));
            preview.Add(new ChartPreviewPointDto
            {
                Label = $"{lower.ToString("0.##", CultureInfo.InvariantCulture)}-{upper.ToString("0.##", CultureInfo.InvariantCulture)}",
                Value = count
            });
        }

        return preview;
    }

    private static IReadOnlyList<KeyCandidateDto> BuildKeyCandidates(
        IReadOnlyList<ColumnAnalysisDto> columns,
        int rowCount)
    {
        return columns
            .Select(column =>
            {
                var reasons = new List<string>();
                var confidence = 0.3m;

                var isKeyLike = IsKeyLikeColumn(column.ColumnName);
                var isUnique = rowCount > 0 && column.UniqueValuesCount == rowCount;
                var isComplete = column.MissingValuesCount == 0;

                if (!isUnique || !isComplete || (!isKeyLike && rowCount < 20))
                {
                    return null;
                }

                if (isKeyLike)
                {
                    confidence += 0.35m;
                    reasons.Add("Column name looks like an identifier, code, key, or reference.");
                }

                if (isUnique)
                {
                    confidence += 0.35m;
                    reasons.Add("Values are unique across rows.");
                }

                if (isComplete)
                {
                    confidence += 0.15m;
                    reasons.Add("No missing values.");
                }

                return new KeyCandidateDto
                {
                    ColumnName = column.ColumnName,
                    Confidence = Math.Min(0.99m, confidence),
                    Reasons = reasons
                };
            })
            .Where(candidate => candidate is not null && candidate.Confidence >= 0.6m)
            .Select(candidate => candidate!)
            .OrderByDescending(candidate => candidate.Confidence)
            .ThenBy(candidate => candidate.ColumnName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static IReadOnlyList<DateRangeDto> BuildDateRanges(IReadOnlyList<ColumnAnalysisDto> columns, Dataset dataset)
    {
        var rows = dataset.Rows
            .OrderBy(row => row.RowNumber)
            .ThenBy(row => row.Id)
            .Select(row => DeserializeRowData(row.RowData))
            .ToList();

        return columns
            .Where(column => IsDateDataType(column.DetectedDataType))
            .Select(column =>
            {
                var rowDates = rows
                    .Select(row => TryGetValue(row, column.ColumnName))
                    .Select(value => DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
                        ? parsed
                        : (DateTimeOffset?)null)
                    .Where(value => value.HasValue)
                    .Select(value => value!.Value)
                    .OrderBy(value => value)
                    .ToList();
                var dates = rowDates.Count > 0
                    ? rowDates
                    : column.SampleValues
                        .Select(value => DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
                            ? parsed
                            : (DateTimeOffset?)null)
                        .Where(value => value.HasValue)
                        .Select(value => value!.Value)
                        .OrderBy(value => value)
                        .ToList();

                return new DateRangeDto
                {
                    ColumnName = column.ColumnName,
                    Min = dates.Count > 0 ? dates.First().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null,
                    Max = dates.Count > 0 ? dates.Last().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null
                };
            })
            .ToList();
    }

    private static IReadOnlyList<RelationshipCandidateHintDto> BuildRelationshipCandidateHints(
        IReadOnlyList<ColumnAnalysisDto> columns,
        int rowCount)
    {
        return columns
            .Where(column => IsKeyLikeColumn(column.ColumnName)
                || (rowCount > 0 && column.UniqueValuesCount == rowCount && column.MissingValuesCount == 0))
            .Select(column => new RelationshipCandidateHintDto
            {
                ColumnName = column.ColumnName,
                Hint = rowCount > 0 && column.UniqueValuesCount == rowCount && column.MissingValuesCount == 0
                    ? "Potential lookup/master key for project relationship discovery."
                    : "Potential source reference for project relationship discovery."
            })
            .ToList();
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

    private static bool IsDateDataType(string dataType)
    {
        return string.Equals(dataType, "datetime", StringComparison.OrdinalIgnoreCase)
            || string.Equals(dataType, "date", StringComparison.OrdinalIgnoreCase)
            || string.Equals(dataType, "timestamp", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsKeyLikeColumn(string columnName)
    {
        var tokens = SplitIdentifierTokens(columnName);
        if (tokens.Any(IsKeyToken))
        {
            return true;
        }

        var normalized = Regex.Replace(columnName.Trim().ToLowerInvariant(), "[^a-z0-9]+", string.Empty);
        return normalized.Length > 2
            && !normalized.EndsWith("paid", StringComparison.Ordinal)
            && (normalized.EndsWith("id", StringComparison.Ordinal)
                || normalized.EndsWith("key", StringComparison.Ordinal)
                || normalized.EndsWith("code", StringComparison.Ordinal)
                || normalized.EndsWith("ref", StringComparison.Ordinal)
                || normalized.EndsWith("no", StringComparison.Ordinal)
                || normalized.EndsWith("num", StringComparison.Ordinal)
                || normalized.EndsWith("number", StringComparison.Ordinal));
    }

    private static string ToTitle(string value)
    {
        var normalized = value.Replace("_", " ").Trim();
        return string.IsNullOrWhiteSpace(normalized)
            ? "Values"
            : CultureInfo.InvariantCulture.TextInfo.ToTitleCase(normalized.ToLowerInvariant());
    }

    private static string? TryGetValue(IDictionary<string, string?> row, string columnName)
    {
        return row.TryGetValue(columnName, out var value) ? NormalizeMissingValue(value) : null;
    }

    private static bool TryParseDecimal(string? value, out decimal result)
    {
        return decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out result);
    }

    private static IReadOnlyList<string> SplitIdentifierTokens(string value)
    {
        var camelSeparated = Regex.Replace(value.Trim(), "([a-z0-9])([A-Z])", "$1_$2");
        return Regex.Split(camelSeparated.ToLowerInvariant(), "[^a-z0-9]+")
            .Where(token => !string.IsNullOrWhiteSpace(token))
            .ToList();
    }

    private static bool IsKeyToken(string token)
    {
        return token is "id" or "key" or "code" or "ref" or "no" or "num" or "number" or "uuid" or "guid";
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
