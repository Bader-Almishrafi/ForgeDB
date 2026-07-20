namespace ForgeDB.API.Services.Exceptions;

public sealed class ActiveCleaningVersionChangedException : Exception
{
    public const string ErrorCode = "active_version_changed";

    public ActiveCleaningVersionChangedException()
        : base("The active dataset version changed. Review the latest suggestions and preview again.")
    {
    }
}
