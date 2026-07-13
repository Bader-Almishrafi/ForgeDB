namespace ForgeDB.API.Services.Exceptions;

/// <summary>
/// A relationship mutation conflicts with an already persisted relationship. Controllers map
/// this exception to HTTP 409 so clients can distinguish conflicts from malformed requests.
/// </summary>
public sealed class DesignRelationshipConflictException : Exception
{
    public DesignRelationshipConflictException(string message)
        : base(message)
    {
    }
}
