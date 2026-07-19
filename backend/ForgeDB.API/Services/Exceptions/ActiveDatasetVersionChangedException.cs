namespace ForgeDB.API.Services.Exceptions;

public sealed class ActiveDatasetVersionChangedException : Exception
{
    public ActiveDatasetVersionChangedException()
        : base("The active dataset version changed while analysis was running. Re-run analysis on the current version.")
    {
    }
}
