namespace ForgeDB.API.Services.Importing;

public sealed class ApiImportOptions
{
    public const string SectionName = "ApiImport";
    public int TimeoutSeconds { get; set; } = 10;
    public int MaximumResponseBytes { get; set; } = 5 * 1024 * 1024;
    public int MaximumRedirects { get; set; } = 3;
    public bool AllowPrivateNetworkInDevelopment { get; set; }
}
