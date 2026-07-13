namespace ForgeDB.API.Services.Importing;

public sealed class ApiImportException : Exception
{
    public ApiImportException(string code, string message, int statusCode = StatusCodes.Status400BadRequest, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
        StatusCode = statusCode;
    }

    public string Code { get; }
    public int StatusCode { get; }
}
