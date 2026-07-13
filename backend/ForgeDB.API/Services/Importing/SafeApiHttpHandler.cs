using System.IO.Compression;
using System.Net;
using System.Net.Sockets;

namespace ForgeDB.API.Services.Importing;

public static class SafeApiHttpHandler
{
    public static HttpMessageHandler Create(ApiImportOptions options, IHostEnvironment environment)
    {
        var allowPrivate = environment.IsDevelopment() && options.AllowPrivateNetworkInDevelopment;
        return new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseProxy = false,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli,
            ConnectTimeout = TimeSpan.FromSeconds(Math.Clamp(options.TimeoutSeconds, 1, 120)),
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            ConnectCallback = async (context, cancellationToken) =>
            {
                var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, cancellationToken);
                ApiUrlSecurity.EnsureAddressesAllowed(context.DnsEndPoint.Host, addresses, allowPrivate);
                Exception? lastError = null;
                foreach (var address in addresses)
                {
                    var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
                    try
                    {
                        await socket.ConnectAsync(new IPEndPoint(address, context.DnsEndPoint.Port), cancellationToken);
                        return new NetworkStream(socket, ownsSocket: true);
                    }
                    catch (Exception exception) when (exception is SocketException or IOException)
                    {
                        lastError = exception;
                        socket.Dispose();
                    }
                }
                throw new HttpRequestException("The validated API address could not be reached.", lastError);
            }
        };
    }
}
