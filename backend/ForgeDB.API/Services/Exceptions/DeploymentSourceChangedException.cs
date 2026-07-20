namespace ForgeDB.API.Services.Exceptions;

public sealed class DeploymentSourceChangedException : Exception
{
    public const string ErrorCode = "active_version_changed";

    public DeploymentSourceChangedException()
        : base("An active dataset version changed before deployment started. Regenerate and validate the schema, then try again.")
    {
    }
}
