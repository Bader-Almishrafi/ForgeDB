namespace ForgeDB.API.Services.Generators;

public interface IDesignSchemaGenerator
{
    /// <summary>Preview format key this generator produces: "sql", "dbml", or "json".</summary>
    string Format { get; }

    string Generate(DesignModelSnapshot snapshot);
}
