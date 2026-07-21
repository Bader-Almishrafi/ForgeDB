using ForgeDB.API.Configuration;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace ForgeDB.API.Tests.Configuration;

public class DatabaseConnectionStringResolverTests
{
    [Fact]
    public void Resolve_PrefersLocalConnectionString()
    {
        const string expected = "Host=localhost;Database=forgedb;Username=postgres;Password=local";
        var configuration = BuildConfiguration(new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = expected,
            ["DATABASE_URL"] = "postgresql://remote:secret@example.com/production"
        });

        Assert.Equal(expected, DatabaseConnectionStringResolver.Resolve(configuration));
    }

    [Fact]
    public void Resolve_ConvertsAndDecodesDatabaseUrl()
    {
        var configuration = BuildConfiguration(new Dictionary<string, string?>
        {
            ["DATABASE_URL"] = "postgresql://forge%40user:p%40ss%3Aword@db.example.com:25060/forge%20db?sslmode=require"
        });

        var result = new NpgsqlConnectionStringBuilder(
            DatabaseConnectionStringResolver.Resolve(configuration));

        Assert.Equal("db.example.com", result.Host);
        Assert.Equal(25060, result.Port);
        Assert.Equal("forge db", result.Database);
        Assert.Equal("forge@user", result.Username);
        Assert.Equal("p@ss:word", result.Password);
        Assert.Equal(SslMode.Require, result.SslMode);
    }

    [Fact]
    public void Resolve_ThrowsClearErrorWhenConfigurationIsMissing()
    {
        var exception = Assert.Throws<InvalidOperationException>(() =>
            DatabaseConnectionStringResolver.Resolve(BuildConfiguration(new Dictionary<string, string?>())));

        Assert.Contains("ConnectionStrings:DefaultConnection or DATABASE_URL", exception.Message);
    }

    private static IConfiguration BuildConfiguration(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
