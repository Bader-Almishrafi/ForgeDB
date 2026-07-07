namespace ForgeDB.API.Services.Exceptions;

/// <summary>Thrown when accept/reject targets an already-decided suggestion, or when accept
/// cannot resolve the suggestion's dataset/column pair to DesignColumns (no design generated
/// yet, or the columns no longer exist). Both map to 409 per prompt §4.</summary>
public class RelationshipSuggestionConflictException : Exception
{
    public RelationshipSuggestionConflictException(string message) : base(message)
    {
    }
}
