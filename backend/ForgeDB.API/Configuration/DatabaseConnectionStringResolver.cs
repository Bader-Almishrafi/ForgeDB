using Npgsql;

namespace ForgeDB.API.Configuration;

public static class DatabaseConnectionStringResolver
{
    public static string Resolve(IConfiguration configuration)
    {
        var localConnectionString = configuration.GetConnectionString("DefaultConnection");
        if (!string.IsNullOrWhiteSpace(localConnectionString))
        {
            return localConnectionString;
        }

        var databaseUrl = configuration["DATABASE_URL"];
        if (string.IsNullOrWhiteSpace(databaseUrl))
        {
            throw new InvalidOperationException(
                "Database configuration is missing. Set ConnectionStrings:DefaultConnection or DATABASE_URL.");
        }

        return ConvertDatabaseUrl(databaseUrl);
    }

    private static string ConvertDatabaseUrl(string databaseUrl)
    {
        if (!Uri.TryCreate(databaseUrl, UriKind.Absolute, out var uri)
            || (uri.Scheme != "postgresql" && uri.Scheme != "postgres")
            || string.IsNullOrWhiteSpace(uri.Host))
        {
            throw InvalidDatabaseUrl();
        }

        try
        {
            var escapedUserInfo = uri.GetComponents(UriComponents.UserInfo, UriFormat.UriEscaped);
            var separatorIndex = escapedUserInfo.IndexOf(':');
            if (separatorIndex < 1)
            {
                throw InvalidDatabaseUrl();
            }

            var username = Uri.UnescapeDataString(escapedUserInfo[..separatorIndex]);
            var password = Uri.UnescapeDataString(escapedUserInfo[(separatorIndex + 1)..]);
            var escapedDatabase = uri.GetComponents(UriComponents.Path, UriFormat.UriEscaped).TrimStart('/');
            var database = Uri.UnescapeDataString(escapedDatabase);

            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(database))
            {
                throw InvalidDatabaseUrl();
            }

            var connectionString = new NpgsqlConnectionStringBuilder
            {
                Host = uri.Host,
                Port = uri.Port > 0 ? uri.Port : 5432,
                Database = database,
                Username = username,
                Password = password,
                SslMode = ParseSslMode(GetQueryValue(uri, "sslmode"))
            };

            return connectionString.ConnectionString;
        }
        catch (UriFormatException)
        {
            throw InvalidDatabaseUrl();
        }
        catch (ArgumentException)
        {
            throw InvalidDatabaseUrl();
        }
    }

    private static SslMode ParseSslMode(string? value) => value?.ToLowerInvariant() switch
    {
        null or "" or "prefer" => SslMode.Prefer,
        "disable" => SslMode.Disable,
        "allow" => SslMode.Allow,
        "require" => SslMode.Require,
        "verify-ca" => SslMode.VerifyCA,
        "verify-full" => SslMode.VerifyFull,
        _ => throw InvalidDatabaseUrl()
    };

    private static string? GetQueryValue(Uri uri, string name)
    {
        foreach (var part in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            var key = Uri.UnescapeDataString(pair[0].Replace('+', ' '));
            if (key.Equals(name, StringComparison.OrdinalIgnoreCase))
            {
                return pair.Length == 2
                    ? Uri.UnescapeDataString(pair[1].Replace('+', ' '))
                    : string.Empty;
            }
        }

        return null;
    }

    private static InvalidOperationException InvalidDatabaseUrl() => new(
        "DATABASE_URL must be a valid PostgreSQL URL with a username, password, host, and database name.");
}
