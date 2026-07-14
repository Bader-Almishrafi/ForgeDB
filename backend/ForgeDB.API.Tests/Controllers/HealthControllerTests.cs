using ForgeDB.API.Controllers;
using ForgeDB.API.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Tests.Controllers;

public class HealthControllerTests
{
    [Fact]
    public async Task Get_ReturnsHealthyWithoutAuthentication_WhenDatabaseIsReachable()
    {
        await using var context = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);
        var controller = new HealthController(context);

        var result = await controller.Get(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Contains("healthy", ok.Value!.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("connected", ok.Value!.ToString(), StringComparison.OrdinalIgnoreCase);
    }
}
