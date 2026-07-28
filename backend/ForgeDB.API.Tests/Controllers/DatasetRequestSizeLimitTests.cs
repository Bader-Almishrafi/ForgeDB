using System.Reflection;
using ForgeDB.API.Controllers;
using ForgeDB.API.Services.Importing;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Tests.Controllers;

public class DatasetRequestSizeLimitTests
{
    [Theory]
    [InlineData(nameof(DatasetsController.PreviewExcel))]
    [InlineData(nameof(DatasetsController.Upload))]
    [InlineData(nameof(DatasetsController.Replace))]
    public void MultipartEndpoint_AllowsMetadataOverheadBeyondTheFileLimit(string methodName)
    {
        var method = typeof(DatasetsController).GetMethod(methodName);
        var limit = method?.CustomAttributes.SingleOrDefault(
            attribute => attribute.AttributeType == typeof(RequestSizeLimitAttribute));

        Assert.NotNull(limit);
        var configuredBytes = Assert.IsType<long>(limit.ConstructorArguments.Single().Value);
        Assert.True(
            configuredBytes > ExcelWorkbookReader.MaximumFileBytes,
            "The multipart request ceiling must be larger than the validated file-size ceiling.");
    }
}
