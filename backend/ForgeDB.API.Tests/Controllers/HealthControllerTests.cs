using ForgeDB.API.Controllers;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Tests.Controllers;

public class HealthControllerTests
{
    [Fact]
    public void Get_ReturnsExpectedHealthyResponse()
    {
        var controller = new HealthController();

        var result = controller.Get();

        var ok = Assert.IsType<OkObjectResult>(result);
        var responseType = ok.Value!.GetType();
        Assert.Equal("healthy", responseType.GetProperty("status")!.GetValue(ok.Value));
        Assert.Equal("ForgeDB.API", responseType.GetProperty("service")!.GetValue(ok.Value));
    }
}
