using System.Text.Json;
using ForgeDB.API.Services.Generators;
using Xunit;

namespace ForgeDB.API.Tests.Generators;

public class JsonSchemaGeneratorTests
{
    [Fact]
    public void Generate_TwoTableWithForeignKey_ProducesDocumentedShape()
    {
        var snapshot = Fixtures.TwoTableWithForeignKey();

        var json = new JsonSchemaGenerator().Generate(snapshot);
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        Assert.Equal(1, root.GetProperty("formatVersion").GetInt32());
        Assert.Equal(2, root.GetProperty("tables").GetArrayLength());
        Assert.Equal(1, root.GetProperty("relationships").GetArrayLength());

        var metadata = root.GetProperty("metadata");
        Assert.Equal(1, metadata.GetProperty("projectId").GetInt32());
        Assert.Equal(1, metadata.GetProperty("revision").GetInt32());
        Assert.True(metadata.TryGetProperty("generatedAt", out _));

        var relationship = root.GetProperty("relationships")[0];
        Assert.Equal("orders", relationship.GetProperty("fromTable").GetString());
        Assert.Equal("customer_id", relationship.GetProperty("fromColumn").GetString());
        Assert.Equal("customers", relationship.GetProperty("toTable").GetString());
        Assert.Equal("id", relationship.GetProperty("toColumn").GetString());
        Assert.Equal("cascade", relationship.GetProperty("onDelete").GetString());
    }
}
