using System.Text.Json;
using System.Text.RegularExpressions;
using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Importing;

public sealed partial class ApiJsonImportService : IApiJsonImportService
{
    private const int MaximumRows = 100_000;
    private const int MaximumColumns = 500;
    private const long MaximumCells = 2_000_000;
    private readonly IApiJsonClient _client;

    public ApiJsonImportService(IApiJsonClient client)
    {
        _client = client;
    }

    public async Task<ApiJsonImportData> FetchAsync(ApiJsonImportRequestDto request, CancellationToken cancellationToken = default)
    {
        if (request is null) throw new ApiImportException("validation_error", "API import request is required.");
        var path = NormalizePath(request.ArrayPath);
        var payload = await _client.GetAsync(request.ApiUrl, cancellationToken);

        try
        {
            using var document = JsonDocument.Parse(payload.Content, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 64
            });
            var (array, resolvedPath) = ResolveArray(document.RootElement, path);
            var data = NormalizeRecords(array);
            return new ApiJsonImportData(data, payload.FinalUri, resolvedPath, payload.StatusCode, payload.ContentType, payload.Content.LongLength);
        }
        catch (JsonException exception)
        {
            throw new ApiImportException("invalid_json", "The API response body is not valid JSON.", StatusCodes.Status422UnprocessableEntity, exception);
        }
    }

    private static (JsonElement Array, string? ResolvedPath) ResolveArray(JsonElement root, string? path)
    {
        if (path is not null)
        {
            var current = root;
            foreach (var segment in path.Split('.'))
            {
                if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                {
                    throw new ApiImportException("array_path_not_found", $"Array path '{path}' was not found in the JSON response.", StatusCodes.Status422UnprocessableEntity);
                }
            }
            if (current.ValueKind != JsonValueKind.Array)
            {
                throw new ApiImportException("array_path_invalid", $"Array path '{path}' does not point to a JSON array.", StatusCodes.Status422UnprocessableEntity);
            }
            return (current, path);
        }

        if (root.ValueKind == JsonValueKind.Array) return (root, null);
        if (root.ValueKind == JsonValueKind.Object)
        {
            if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array) return (data, "data");
            var candidates = root.EnumerateObject().Where(property => property.Value.ValueKind == JsonValueKind.Array).ToList();
            if (candidates.Count == 1) return (candidates[0].Value, candidates[0].Name);
        }

        throw new ApiImportException("object_array_required", "The JSON response does not contain a usable object array. Supply an Array Path for nested arrays.", StatusCodes.Status422UnprocessableEntity);
    }

    private static TabularImportData NormalizeRecords(JsonElement array)
    {
        var elements = array.EnumerateArray().ToList();
        if (elements.Count == 0)
        {
            throw new ApiImportException("empty_array", "The JSON array is empty and cannot be imported.", StatusCodes.Status422UnprocessableEntity);
        }
        if (elements.Count > MaximumRows)
        {
            throw new ApiImportException("row_limit", $"The JSON array exceeds the {MaximumRows:N0} record limit.", StatusCodes.Status413PayloadTooLarge);
        }
        if (elements.Any(element => element.ValueKind != JsonValueKind.Object))
        {
            throw new ApiImportException("object_array_required", "Every item in the JSON array must be an object.", StatusCodes.Status422UnprocessableEntity);
        }

        var columns = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var element in elements)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (seen.Add(property.Name)) columns.Add(property.Name);
            }
        }
        if (columns.Count == 0)
        {
            throw new ApiImportException("object_array_required", "The JSON objects do not contain any fields.", StatusCodes.Status422UnprocessableEntity);
        }
        if (columns.Count > MaximumColumns || (long)columns.Count * elements.Count > MaximumCells)
        {
            throw new ApiImportException("data_limit", "The JSON data exceeds the supported column or cell limit.", StatusCodes.Status413PayloadTooLarge);
        }

        var rows = elements.Select(element =>
        {
            var values = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                values[property.Name] = NormalizeValue(property.Value);
            }
            return (IReadOnlyDictionary<string, string?>)columns.ToDictionary(column => column, column => values.GetValueOrDefault(column), StringComparer.Ordinal);
        }).ToList();
        return new TabularImportData(columns, rows);
    }

    private static string? NormalizeValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        JsonValueKind.String => value.GetString(),
        _ => value.GetRawText()
    };

    private static string? NormalizePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        var normalized = path.Trim();
        if (normalized.Length > 200 || normalized.Split('.').Length > 10 || !SafeArrayPath().IsMatch(normalized))
        {
            throw new ApiImportException("invalid_array_path", "Array Path must contain only safe dot-separated JSON property names.");
        }
        return normalized;
    }

    [GeneratedRegex(@"^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex SafeArrayPath();
}
