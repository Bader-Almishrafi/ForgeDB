namespace ForgeDB.API.Services.Generators;

public interface IDesignSchemaGeneratorResolver
{
    IReadOnlyCollection<string> SupportedFormats { get; }
    string Generate(string format, DesignModelSnapshot snapshot);
}

/// <summary>Resolves the SQL/DBML/JSON generator by format key. Both the preview endpoint and
/// the export packager go through this resolver, so they always share the same code path.</summary>
public class DesignSchemaGeneratorResolver : IDesignSchemaGeneratorResolver
{
    private readonly Dictionary<string, IDesignSchemaGenerator> _generatorsByFormat;

    public DesignSchemaGeneratorResolver(IEnumerable<IDesignSchemaGenerator> generators)
    {
        _generatorsByFormat = generators.ToDictionary(
            generator => generator.Format,
            StringComparer.OrdinalIgnoreCase);
    }

    public IReadOnlyCollection<string> SupportedFormats => _generatorsByFormat.Keys;

    public string Generate(string format, DesignModelSnapshot snapshot)
    {
        if (!_generatorsByFormat.TryGetValue(format, out var generator))
        {
            throw new ArgumentException($"Unsupported preview format '{format}'. Supported formats: {string.Join(", ", SupportedFormats)}.", nameof(format));
        }

        return generator.Generate(snapshot);
    }
}
