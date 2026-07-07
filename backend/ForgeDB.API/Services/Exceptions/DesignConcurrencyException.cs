namespace ForgeDB.API.Services.Exceptions;

/// <summary>Thrown when a mutating design request's If-Match revision no longer matches the
/// DesignModel's current revision (either the caller sent a stale value, or EF's own
/// concurrency-token check caught a genuine race between two concurrent writers).</summary>
public class DesignConcurrencyException : Exception
{
    public int CurrentRevision { get; }

    public DesignConcurrencyException(int currentRevision)
        : base($"Design has been modified since revision was read. Current revision is {currentRevision}.")
    {
        CurrentRevision = currentRevision;
    }
}
