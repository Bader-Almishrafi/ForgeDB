namespace ForgeDB.API.Models.DTOs;

public class SchemaGenerateRequestDto
{
    public string SchemaName { get; set; } = string.Empty;
    public object? Options { get; set; }
}
