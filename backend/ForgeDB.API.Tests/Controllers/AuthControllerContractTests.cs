using System.Reflection;
using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;
using ForgeDB.API.Controllers;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace ForgeDB.API.Tests.Controllers;

public class AuthControllerContractTests
{
    [Fact]
    public void ChangePassword_UsesProtectedPutRouteWithoutUserIdParameter()
    {
        var method = typeof(AuthController).GetMethod(nameof(AuthController.ChangePassword));

        Assert.NotNull(method);
        Assert.NotNull(method!.GetCustomAttribute<AuthorizeAttribute>());
        Assert.Equal("change-password", method.GetCustomAttribute<HttpPutAttribute>()?.Template);
        Assert.DoesNotContain(method.GetParameters(), parameter =>
            parameter.Name?.Contains("userId", StringComparison.OrdinalIgnoreCase) == true);
    }

    [Fact]
    public async Task ChangePassword_UsesJwtSubjectAndReturnsNoContent()
    {
        var authService = new FakeAuthService();
        var controller = new AuthController(authService, new FakeEnvironment(Environments.Development))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [new Claim(JwtRegisteredClaimNames.Sub, "42")],
                        "Test"))
                }
            }
        };

        var result = await controller.ChangePassword(
            new ChangePasswordRequestDto
            {
                CurrentPassword = "OldPassword123",
                NewPassword = "NewPassword456"
            },
            CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(42, authService.LastAuthenticatedUserId);
    }

    [Fact]
    public async Task RequestPasswordReset_ReturnsSameGenericMessageForEveryEmail()
    {
        var controller = new AuthController(new FakeAuthService(), new FakeEnvironment(Environments.Development));

        var known = await controller.RequestPasswordReset(
            new RequestPasswordResetDto { Email = "known@example.com" },
            CancellationToken.None);
        var unknown = await controller.RequestPasswordReset(
            new RequestPasswordResetDto { Email = "unknown@example.com" },
            CancellationToken.None);

        var knownResponse = Assert.IsType<RequestPasswordResetResponseDto>(
            Assert.IsType<OkObjectResult>(known.Result).Value);
        var unknownResponse = Assert.IsType<RequestPasswordResetResponseDto>(
            Assert.IsType<OkObjectResult>(unknown.Result).Value);
        Assert.Equal(knownResponse.Message, unknownResponse.Message);
        Assert.NotNull(knownResponse.DevelopmentToken);
        Assert.NotNull(unknownResponse.DevelopmentToken);
    }

    [Fact]
    public async Task RequestPasswordReset_DoesNotExposeTokenInProduction()
    {
        var controller = new AuthController(new FakeAuthService(), new FakeEnvironment(Environments.Production));

        var result = await controller.RequestPasswordReset(
            new RequestPasswordResetDto { Email = "user@example.com" },
            CancellationToken.None);

        var response = Assert.IsType<RequestPasswordResetResponseDto>(
            Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(response.DevelopmentToken);
    }

    [Fact]
    public async Task ResetPassword_ReturnsNoContentAfterTokenIsConsumed()
    {
        var controller = new AuthController(new FakeAuthService(), new FakeEnvironment(Environments.Development));

        var result = await controller.ResetPassword(
            new ResetPasswordDto
            {
                Email = "user@example.com",
                Token = "one-time-token",
                NewPassword = "NewPassword456"
            },
            CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
    }

    private sealed class FakeAuthService : IAuthService
    {
        public int? LastAuthenticatedUserId { get; private set; }

        public Task<AuthResponseDto> RegisterAsync(
            RegisterRequestDto request,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<AuthResponseDto> LoginAsync(
            LoginRequestDto request,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task ChangePasswordAsync(
            int authenticatedUserId,
            ChangePasswordRequestDto request,
            CancellationToken cancellationToken = default)
        {
            LastAuthenticatedUserId = authenticatedUserId;
            return Task.CompletedTask;
        }

        public Task<string> RequestPasswordResetAsync(
            RequestPasswordResetDto request,
            CancellationToken cancellationToken = default) => Task.FromResult(Guid.NewGuid().ToString("N"));

        public Task ResetPasswordAsync(
            ResetPasswordDto request,
            CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class FakeEnvironment : IWebHostEnvironment
    {
        public FakeEnvironment(string environmentName)
        {
            EnvironmentName = environmentName;
        }

        public string ApplicationName { get; set; } = "ForgeDB.API.Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = string.Empty;
        public string EnvironmentName { get; set; }
        public string ContentRootPath { get; set; } = string.Empty;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
