namespace ForgeDB.API.Services.Exceptions;

public sealed class DeploymentInProgressException : Exception
{
    public const string ErrorCode = "deployment_in_progress";

    public DeploymentInProgressException()
        : base("A deployment is already running for this project.")
    {
    }
}
