namespace ForgeDB.API.Services.Exceptions;

/// <summary>Thrown when /design/generate targets a project that already has a DesignModel but
/// the caller sent no If-Match header. Regenerating over an existing design is a mutation like
/// any other (prompt FIX 2 / decision D2); only the fresh-create path is precondition-free.
/// Maps to 428 Precondition Required.</summary>
public class DesignPreconditionRequiredException : Exception
{
    public DesignPreconditionRequiredException()
        : base("If-Match header with the current revision is required.")
    {
    }
}
