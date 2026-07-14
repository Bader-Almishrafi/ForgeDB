using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using ForgeDB.API.Clients;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Importing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace ForgeDB.API.Tests.Services;

public class ApiJsonImportTests
{
    [Theory]
    [InlineData("")]
    [InlineData("not a url")]
    [InlineData("file:///etc/passwd")]
    [InlineData("ftp://example.com/data.json")]
    [InlineData("http://user:password@example.com/data.json")]
    public async Task Client_RejectsInvalidOrUnsupportedUrls(string url)
    {
        var client = BuildClient(_ => JsonResponse("[]"));

        var error = await Assert.ThrowsAsync<ApiImportException>(() => client.GetAsync(url));

        Assert.Equal("invalid_url", error.Code);
    }

    [Theory]
    [InlineData("http://localhost/data")]
    [InlineData("http://service.localhost/data")]
    [InlineData("http://metadata.google.internal/computeMetadata/v1/")]
    [InlineData("http://instance-data/latest/meta-data/")]
    public async Task Client_BlocksLocalhostAndKnownMetadataHostsBeforeConnecting(string url)
    {
        var sends = 0;
        var client = BuildClient(_ =>
        {
            sends++;
            return JsonResponse("[]");
        });

        var error = await Assert.ThrowsAsync<ApiImportException>(() => client.GetAsync(url));

        Assert.Equal("blocked_address", error.Code);
        Assert.Equal(0, sends);
    }

    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("10.0.0.1")]
    [InlineData("172.16.0.1")]
    [InlineData("192.168.1.1")]
    [InlineData("169.254.169.254")]
    [InlineData("::1")]
    [InlineData("fe80::1")]
    [InlineData("fd00::1")]
    public async Task Client_BlocksPrivateLoopbackLinkLocalAndMetadataAddresses(string address)
    {
        var client = BuildClient(_ => JsonResponse("[]"), _ => [IPAddress.Parse(address)]);

        var error = await Assert.ThrowsAsync<ApiImportException>(() => client.GetAsync("https://example.com/data"));

        Assert.Equal("blocked_address", error.Code);
    }

    [Theory]
    [InlineData("0.0.0.0")]
    [InlineData("169.254.169.254")]
    [InlineData("198.51.100.10")]
    [InlineData("203.0.113.10")]
    [InlineData("fe80::1")]
    [InlineData("2001:db8::1")]
    public void DevelopmentPrivateNetworkOverride_StillBlocksMetadataLinkLocalAndReservedAddresses(string address)
    {
        var error = Assert.Throws<ApiImportException>(() =>
            ApiUrlSecurity.EnsureAddressesAllowed("fixture.example", [IPAddress.Parse(address)], allowPrivate: true));

        Assert.Equal("blocked_address", error.Code);
    }

    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("10.0.0.5")]
    [InlineData("172.16.0.5")]
    [InlineData("192.168.1.5")]
    [InlineData("fd00::1")]
    public void DevelopmentPrivateNetworkOverride_AllowsOnlyLoopbackAndPrivateFixtureAddresses(string address)
    {
        var exception = Record.Exception(() =>
            ApiUrlSecurity.EnsureAddressesAllowed("fixture.example", [IPAddress.Parse(address)], allowPrivate: true));

        Assert.Null(exception);
    }

    [Fact]
    public async Task Client_BlocksRedirectIntoPrivateAddress()
    {
        var sends = 0;
        var client = BuildClient(_ =>
        {
            sends++;
            var response = new HttpResponseMessage(HttpStatusCode.Redirect);
            response.Headers.Location = new Uri("http://internal.example/data");
            return response;
        }, host => host == "internal.example" ? [IPAddress.Parse("10.0.0.5")] : [IPAddress.Parse("8.8.8.8")]);

        var error = await Assert.ThrowsAsync<ApiImportException>(() => client.GetAsync("https://public.example/data"));

        Assert.Equal("blocked_address", error.Code);
        Assert.Equal(1, sends);
    }

    [Fact]
    public async Task Client_ReportsTimeout()
    {
        var handler = new StubHandler(async (_, token) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, token);
            return JsonResponse("[]");
        });
        var client = BuildClient(handler, new ApiImportOptions { TimeoutSeconds = 1 });

        var error = await Assert.ThrowsAsync<ApiImportException>(() => client.GetAsync("https://example.com/data"));

        Assert.Equal("timeout", error.Code);
        Assert.Equal(504, error.StatusCode);
    }

    [Fact]
    public async Task Client_RejectsOversizedResponseFromContentLength()
    {
        var client = BuildClient(_ => JsonResponse(new string('x', 1_025)), options: new ApiImportOptions { MaximumResponseBytes = 1_024 });

        var error = await Assert.ThrowsAsync<ApiImportException>(() => client.GetAsync("https://example.com/data"));

        Assert.Equal("response_too_large", error.Code);
        Assert.Equal(413, error.StatusCode);
    }

    [Fact]
    public async Task Client_RejectsOversizedChunkedResponseWhileStreaming()
    {
        var response = JsonResponse(new string('x', 1_025));
        response.Content.Headers.ContentLength = null;
        var client = BuildClient(_ => response, options: new ApiImportOptions { MaximumResponseBytes = 1_024 });

        var error = await Assert.ThrowsAsync<ApiImportException>(() => client.GetAsync("https://example.com/data"));

        Assert.Equal("response_too_large", error.Code);
        Assert.Equal(413, error.StatusCode);
    }

    [Fact]
    public async Task Client_RejectsNonJsonContentType()
    {
        var client = BuildClient(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html></html>", Encoding.UTF8, "text/html") });

        var error = await Assert.ThrowsAsync<ApiImportException>(() => client.GetAsync("https://example.com/data"));

        Assert.Equal("non_json", error.Code);
    }

    [Fact]
    public async Task PreviewApi_SupportsDirectObjectArray()
    {
        var service = await BuildDatasetServiceAsync("[{\"id\":1,\"name\":\"Ahmed\"},{\"id\":2,\"name\":\"Sara\"}]");

        var preview = await service.PreviewApiAsync(new ApiJsonImportRequestDto { ApiUrl = "https://example.com/users" });

        Assert.Equal(2, preview.RowCount);
        Assert.Equal(["id", "name"], preview.Columns);
        Assert.Equal("Ahmed", preview.Rows[0]["name"]);
    }

    [Fact]
    public async Task PreviewApi_SupportsNestedArrayPath_AndFillsMissingKeysWithNull()
    {
        var service = await BuildDatasetServiceAsync("{\"result\":{\"items\":[{\"id\":1,\"name\":\"Ahmed\"},{\"id\":2,\"email\":\"sara@example.com\"}]}}");

        var preview = await service.PreviewApiAsync(new ApiJsonImportRequestDto { ApiUrl = "https://example.com/users", ArrayPath = "result.items" });

        Assert.Equal("result.items", preview.ArrayPath);
        Assert.Equal(["id", "name", "email"], preview.Columns);
        Assert.Null(preview.Rows[0]["email"]);
        Assert.Null(preview.Rows[1]["name"]);
    }

    [Fact]
    public async Task PreviewApi_AutoDetectsTopLevelDataArray()
    {
        var service = await BuildDatasetServiceAsync("{\"data\":[{\"id\":1}]}");

        var preview = await service.PreviewApiAsync(new ApiJsonImportRequestDto { ApiUrl = "https://example.com/users" });

        Assert.Equal("data", preview.ArrayPath);
        Assert.Single(preview.Rows);
    }

    [Theory]
    [InlineData("result.missing", "array_path_not_found")]
    [InlineData("result", "array_path_invalid")]
    [InlineData("result[0]", "invalid_array_path")]
    public async Task PreviewApi_RejectsInvalidOrMissingArrayPath(string path, string expectedCode)
    {
        var service = await BuildDatasetServiceAsync("{\"result\":{\"items\":[{\"id\":1}]}}");

        var error = await Assert.ThrowsAsync<ApiImportException>(() => service.PreviewApiAsync(new ApiJsonImportRequestDto
        {
            ApiUrl = "https://example.com/users",
            ArrayPath = path
        }));

        Assert.Equal(expectedCode, error.Code);
    }

    [Fact]
    public async Task PreviewApi_RejectsInvalidJsonAndArraysWithoutObjects()
    {
        var invalidJson = await BuildDatasetServiceAsync("{broken");
        var primitiveArray = await BuildDatasetServiceAsync("[1,2,3]");

        Assert.Equal("invalid_json", (await Assert.ThrowsAsync<ApiImportException>(() => invalidJson.PreviewApiAsync(new() { ApiUrl = "https://example.com/data" }))).Code);
        Assert.Equal("object_array_required", (await Assert.ThrowsAsync<ApiImportException>(() => primitiveArray.PreviewApiAsync(new() { ApiUrl = "https://example.com/data" }))).Code);
    }

    [Fact]
    public async Task ImportApi_PersistsDatasetRowsColumnsNullsAndCorrectSourceType()
    {
        await using var context = NewContext();
        var projectId = await SeedProjectAsync(context);
        var service = await BuildDatasetServiceAsync("[{\"id\":1,\"name\":\"Ahmed\"},{\"id\":2}]", context);

        var response = await service.ImportApiAsync(projectId, new ApiJsonImportRequestDto { ApiUrl = "https://example.com/customers", TableName = "api_customers" });

        Assert.Equal("api", response.SourceType);
        Assert.Equal(2, response.RowCount);
        Assert.Equal(2, response.ColumnCount);
        var dataset = await context.Datasets.Include(item => item.Columns).Include(item => item.Rows).SingleAsync();
        Assert.Equal("api", dataset.SourceType);
        Assert.Equal("https://example.com/customers", dataset.SourceUrl);
        var second = JsonSerializer.Deserialize<Dictionary<string, string?>>(dataset.Rows.OrderBy(row => row.RowNumber).Last().RowData)!;
        Assert.Null(second["name"]);
    }

    private static ApiJsonClient BuildClient(
        Func<HttpRequestMessage, HttpResponseMessage> response,
        Func<string, IPAddress[]>? resolve = null,
        ApiImportOptions? options = null) => BuildClient(
            new StubHandler((request, _) => Task.FromResult(response(request))), options, resolve);

    private static ApiJsonClient BuildClient(
        StubHandler handler,
        ApiImportOptions? options = null,
        Func<string, IPAddress[]>? resolve = null)
    {
        var resolver = new StubResolver(resolve ?? (_ => [IPAddress.Parse("8.8.8.8")]));
        return new ApiJsonClient(new HttpClient(handler), resolver, Options.Create(options ?? new ApiImportOptions()), new TestEnvironment());
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    private static Task<DatasetImportService> BuildDatasetServiceAsync(string json, ForgeDbContext? context = null)
    {
        context ??= NewContext();
        var client = BuildClient(_ => JsonResponse(json));
        var apiImport = new ApiJsonImportService(client);
        var python = new PythonAnalysisClient(new HttpClient { BaseAddress = new Uri("http://localhost:8002") });
        return Task.FromResult(new DatasetImportService(new DatasetRepository(context), python, NullLogger<DatasetImportService>.Instance, new ExcelWorkbookReader(), apiImport));
    }

    private static ForgeDbContext NewContext() => new(new DbContextOptionsBuilder<ForgeDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static async Task<int> SeedProjectAsync(ForgeDbContext context)
    {
        var user = new User { FirstName = "API", LastName = "Owner", Email = $"{Guid.NewGuid()}@example.com", PasswordHash = "x", Role = "user", CreatedAt = DateTime.UtcNow };
        var project = new Project { Name = "API project", User = user, CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();
        return project.Id;
    }

    private sealed class StubResolver(Func<string, IPAddress[]> resolve) : IHostAddressResolver
    {
        public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken = default) => Task.FromResult(resolve(host));
    }

    private sealed class StubHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request, cancellationToken);
    }

    private sealed class TestEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Production;
        public string ApplicationName { get; set; } = "ForgeDB.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
