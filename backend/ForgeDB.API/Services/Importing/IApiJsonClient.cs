namespace ForgeDB.API.Services.Importing;

public sealed record ApiJsonPayload(
    Uri FinalUri,
    int StatusCode,
    string ContentType,
    byte[] Content);

public interface IApiJsonClient
{
    Task<ApiJsonPayload> GetAsync(string url, CancellationToken cancellationToken = default);
}
