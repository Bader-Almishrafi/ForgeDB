namespace ForgeDB.API.Services;

internal static class DeploymentRecoveryPolicy
{
    internal const string AbandonedFailureMessage =
        "Deployment was abandoned before completion and is no longer considered running.";
    internal static readonly TimeSpan AbandonedRunningTimeout = TimeSpan.FromMinutes(30);
}
