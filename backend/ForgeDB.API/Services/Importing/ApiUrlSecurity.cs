using System.Net;
using System.Net.Sockets;

namespace ForgeDB.API.Services.Importing;

public static class ApiUrlSecurity
{
    private static readonly HashSet<string> MetadataHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "instance-data",
        "metadata",
        "metadata.google.internal",
        "metadata.goog",
        "metadata.azure.internal"
    };

    public static Uri ParseAndValidate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ApiImportException("invalid_url", "API URL is required.");
        }

        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || string.IsNullOrWhiteSpace(uri.Host))
        {
            throw new ApiImportException("invalid_url", "API URL must be an absolute HTTP or HTTPS URL.");
        }

        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new ApiImportException("invalid_url", "API URLs cannot contain embedded credentials.");
        }

        var host = uri.IdnHost.TrimEnd('.');
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase)
            || MetadataHosts.Contains(host)
            || host.EndsWith(".metadata.google.internal", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiImportException("blocked_address", "The API URL resolves to a local or private address.");
        }

        return uri;
    }

    public static void EnsureAddressesAllowed(string host, IReadOnlyCollection<IPAddress> addresses, bool allowPrivate)
    {
        if (addresses.Count == 0)
        {
            throw new ApiImportException("dns_error", $"The API host '{host}' did not resolve to an address.", StatusCodes.Status502BadGateway);
        }

        // The development override exists so a developer can import from a loopback/RFC1918
        // fixture service. It must never turn off protection for link-local metadata endpoints,
        // unspecified, reserved, benchmarking/documentation, or multicast addresses.
        if (addresses.Any(IsAlwaysBlockedAddress)
            || (!allowPrivate && addresses.Any(IsPrivateNetworkAddress)))
        {
            throw new ApiImportException("blocked_address", "The API URL resolves to a local, private, link-local, reserved, or metadata-service address.");
        }
    }

    public static bool IsBlockedAddress(IPAddress address)
        => IsAlwaysBlockedAddress(address) || IsPrivateNetworkAddress(address);

    private static bool IsPrivateNetworkAddress(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        if (IPAddress.IsLoopback(address))
        {
            return true;
        }

        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return bytes[0] == 10
                || bytes[0] == 127
                || (bytes[0] == 172 && bytes[1] is >= 16 and <= 31)
                || (bytes[0] == 192 && bytes[1] == 168);
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            return (bytes[0] & 0xFE) == 0xFC;
        }

        return true;
    }

    private static bool IsAlwaysBlockedAddress(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        if (address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any)
            || address.Equals(IPAddress.None) || address.Equals(IPAddress.IPv6None))
        {
            return true;
        }

        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return bytes[0] == 0
                || (bytes[0] == 100 && bytes[1] is >= 64 and <= 127)
                || (bytes[0] == 169 && bytes[1] == 254)
                || (bytes[0] == 192 && bytes[1] == 0 && bytes[2] is 0 or 2)
                || (bytes[0] == 198 && bytes[1] is 18 or 19)
                || (bytes[0] == 198 && bytes[1] == 51 && bytes[2] == 100)
                || (bytes[0] == 203 && bytes[1] == 0 && bytes[2] == 113)
                || bytes[0] >= 224;
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            return (bytes[0] == 0xFE && (bytes[1] & 0xC0) == 0x80)
                || bytes[0] == 0xFF
                || (bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0x0D && bytes[3] == 0xB8);
        }

        return true;
    }
}
