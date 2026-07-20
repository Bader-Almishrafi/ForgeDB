using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using ForgeDB.API.Controllers;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Generators;
using ForgeDB.API.Services.Validation;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Tests.Services;

public class ProjectWorkflowServiceTests
{
    [Fact]
    public async Task EmptyProject_IsNoData()
    {
        await using var fixture = await Fixture.CreateAsync();

        var workflow = await fixture.Service.GetWorkflowAsync(fixture.ProjectId, fixture.UserId);

        Assert.Equal(ProjectWorkflowStates.NoData, workflow.WorkflowState);
        Assert.Equal(ProjectWorkflowSteps.Data, workflow.CurrentStep);
        Assert.Equal($"/projects/{fixture.ProjectId}/data", workflow.RecommendedRoute);
        Assert.True(workflow.CanImport);
        Assert.False(workflow.CanAnalyze || workflow.CanClean || workflow.CanBuildSchema || workflow.CanExport || workflow.CanDeploy);
        Assert.Contains("no_data", workflow.BlockerCodes);
    }

    [Fact]
    public async Task ImportedDataset_IsNeedsAnalysis()
    {
        await using var fixture = await Fixture.CreateAsync();
        var dataset = await fixture.AddDatasetAsync("customers", analyzed: false);

        var workflow = await fixture.Service.EvaluateAsync(fixture.ProjectId);

        Assert.Equal(ProjectWorkflowStates.NeedsAnalysis, workflow.WorkflowState);
        Assert.Equal(ProjectWorkflowSteps.Analyze, workflow.CurrentStep);
        Assert.True(workflow.CanAnalyze);
        Assert.False(workflow.CanClean || workflow.CanBuildSchema || workflow.CanExport || workflow.CanDeploy);
        var summary = Assert.Single(workflow.Datasets);
        Assert.Equal(dataset.Id, summary.DatasetId);
        Assert.Equal(1, summary.ActiveVersionNumber);
        Assert.True(summary.RequiresAnalysis);
        Assert.False(summary.HasCurrentAnalysis);
        Assert.Contains("analysis_required", workflow.BlockerCodes);
    }

    [Fact]
    public async Task AnalyzedDatasetWithoutQualityConfirmation_IsAnalyzedAndCanClean()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.AddDatasetAsync("customers", analyzed: true);

        var workflow = await fixture.Service.EvaluateAsync(fixture.ProjectId);

        Assert.Equal(ProjectWorkflowStates.Analyzed, workflow.WorkflowState);
        Assert.Equal(ProjectWorkflowSteps.Clean, workflow.CurrentStep);
        Assert.True(workflow.CanClean);
        Assert.False(workflow.CanBuildSchema || workflow.CanExport || workflow.CanDeploy);
        Assert.Contains("quality_confirmation_required", workflow.BlockerCodes);
    }

    [Fact]
    public async Task CleanedActiveVersionWithoutAnalysis_IsNeedsReanalysis()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.AddDatasetAsync("customers", analyzed: false, cleaned: true);

        var workflow = await fixture.Service.EvaluateAsync(fixture.ProjectId);

        Assert.Equal(ProjectWorkflowStates.NeedsReanalysis, workflow.WorkflowState);
        Assert.Equal(ProjectWorkflowSteps.Analyze, workflow.CurrentStep);
        Assert.Equal(2, Assert.Single(workflow.Datasets).ActiveVersionNumber);
        Assert.Contains("analysis_stale", workflow.BlockerCodes);
        Assert.False(workflow.CanClean || workflow.CanBuildSchema || workflow.CanExport || workflow.CanDeploy);
    }

    [Fact]
    public async Task ExactAnalyzedAndConfirmedVersions_AreReadyForSchema()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.AddDatasetAsync("customers", analyzed: true);
        await fixture.ConfirmCurrentVersionsAsync();

        var workflow = await fixture.Service.EvaluateAsync(fixture.ProjectId);

        Assert.Equal(ProjectWorkflowStates.ReadyForSchema, workflow.WorkflowState);
        Assert.Equal(ProjectWorkflowSteps.Schema, workflow.CurrentStep);
        Assert.True(workflow.CanBuildSchema);
        Assert.True(Assert.Single(workflow.Datasets).IsQualityConfirmed);
        Assert.Contains("schema_required", workflow.BlockerCodes);
    }

    [Theory]
    [InlineData(DesignStatus.Draft)]
    [InlineData(DesignStatus.Invalid)]
    public async Task DraftOrInvalidSchema_RemainsInSchemaStep(string status)
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.AddDatasetAsync("customers", analyzed: true);
        await fixture.ConfirmCurrentVersionsAsync();
        await fixture.AddSchemaAsync(status);

        var workflow = await fixture.Service.EvaluateAsync(fixture.ProjectId);

        Assert.Equal(ProjectWorkflowStates.SchemaDraft, workflow.WorkflowState);
        Assert.Equal(ProjectWorkflowSteps.Schema, workflow.CurrentStep);
        Assert.Equal(status, workflow.SchemaStatus);
        Assert.True(workflow.CanBuildSchema);
        Assert.False(workflow.CanExport || workflow.CanDeploy);
        Assert.Contains("schema_invalid", workflow.BlockerCodes);
    }

    [Fact]
    public async Task SchemaMappedToOlderVersion_IsStaleAndBlocked()
    {
        await using var fixture = await Fixture.CreateAsync();
        var dataset = await fixture.AddDatasetAsync("customers", analyzed: true);
        await fixture.ConfirmCurrentVersionsAsync();
        await fixture.AddSchemaAsync(DesignStatus.Valid);
        await fixture.ActivateNewVersionAsync(dataset.Id, analyzed: true);
        await fixture.ConfirmCurrentVersionsAsync();

        var workflow = await fixture.Service.EvaluateAsync(fixture.ProjectId);

        Assert.Equal(ProjectWorkflowStates.SchemaDraft, workflow.WorkflowState);
        Assert.Equal("Stale", workflow.SchemaStatus);
        Assert.Contains("schema_stale", workflow.BlockerCodes);
        Assert.False(workflow.CanExport || workflow.CanDeploy);
    }

    [Fact]
    public async Task ValidSchemaOverCleanedVersions_IsReadyForExportAndDeployment()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.AddDatasetAsync("customers", analyzed: true, cleaned: true);
        await fixture.ConfirmCurrentVersionsAsync();
        await fixture.AddSchemaAsync(DesignStatus.Valid);

        var workflow = await fixture.Service.EvaluateAsync(fixture.ProjectId);

        Assert.Equal(ProjectWorkflowStates.ReadyToDeploy, workflow.WorkflowState);
        Assert.Equal(ProjectWorkflowSteps.ExportAndDeploy, workflow.CurrentStep);
        Assert.True(workflow.CanExport);
        Assert.True(workflow.CanDeploy);
        Assert.Empty(workflow.BlockerCodes);
    }

    [Fact]
    public async Task ValidSchemaOverRawVersion_IsSchemaValidButDeploymentNotReady()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.AddDatasetAsync("customers", analyzed: true);
        await fixture.ConfirmCurrentVersionsAsync();
        await fixture.AddSchemaAsync(DesignStatus.Valid);

        var workflow = await fixture.Service.EvaluateAsync(fixture.ProjectId);

        Assert.Equal(ProjectWorkflowStates.SchemaValid, workflow.WorkflowState);
        Assert.True(workflow.CanExport);
        Assert.False(workflow.CanDeploy);
        Assert.Contains("deployment_not_ready", workflow.BlockerCodes);
    }

    [Fact]
    public async Task SuccessfulCurrentRevisionDeployment_IsDeployed()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.AddDatasetAsync("customers", analyzed: true, cleaned: true);
        await fixture.ConfirmCurrentVersionsAsync();
        var design = await fixture.AddSchemaAsync(DesignStatus.Valid);
        fixture.Context.Deployments.Add(new Deployment
        {
            ProjectId = fixture.ProjectId,
            DesignRevision = design.Revision,
            SchemaName = "workflow",
            Status = DeploymentStatus.Completed,
            TriggeredByUserId = fixture.UserId,
            StartedAt = DateTime.UtcNow,
            CompletedAt = DateTime.UtcNow
        });
        await fixture.Context.SaveChangesAsync();

        var workflow = await fixture.Service.EvaluateAsync(fixture.ProjectId);

        Assert.Equal(ProjectWorkflowStates.Deployed, workflow.WorkflowState);
        Assert.Equal(ProjectWorkflowSteps.ExportAndDeploy, workflow.CurrentStep);
        Assert.Equal(DeploymentStatus.Completed, workflow.LatestDeploymentStatus);
        Assert.True(workflow.CanExport && workflow.CanDeploy);
    }

    [Fact]
    public async Task MultipleDatasets_DoNotAdvanceWhenOneNeedsAnalysis()
    {
        await using var fixture = await Fixture.CreateAsync();
        var analyzed = await fixture.AddDatasetAsync("customers", analyzed: true);
        await fixture.AddDatasetAsync("orders", analyzed: false);
        await fixture.ConfirmVersionsAsync(new Dictionary<int, int>
        {
            [analyzed.Id] = analyzed.ActiveVersionId!.Value
        });

        var workflow = await fixture.Service.EvaluateAsync(fixture.ProjectId);

        Assert.Equal(ProjectWorkflowStates.NeedsAnalysis, workflow.WorkflowState);
        Assert.False(workflow.CanClean || workflow.CanBuildSchema);
        Assert.True(workflow.Datasets.Single(dataset => dataset.DatasetId == analyzed.Id).IsQualityConfirmed);
        Assert.True(workflow.Datasets.Single(dataset => dataset.DatasetName == "orders").RequiresAnalysis);
    }

    [Fact]
    public async Task EndpointRejectsAnotherUsersProjectAndRequiresAuthorization()
    {
        await using var fixture = await Fixture.CreateAsync();
        var controller = new ProjectWorkflowController(fixture.Service)
        {
            ControllerContext = ControllerContextFor(fixture.UserId + 99)
        };

        var response = await controller.Get(fixture.ProjectId, CancellationToken.None);

        var forbidden = Assert.IsType<ObjectResult>(response.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, forbidden.StatusCode);
        Assert.NotNull(typeof(ProjectWorkflowController).GetCustomAttribute<AuthorizeAttribute>());

        controller.ControllerContext = ControllerContextFor(fixture.UserId);
        var owned = await controller.Get(fixture.ProjectId, CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(owned.Result);
        Assert.Equal(fixture.ProjectId, Assert.IsType<ProjectWorkflowResponseDto>(ok.Value).ProjectId);
    }

    [Fact]
    public async Task WorkflowIsReconstructedOnlyFromPersistedBackendState()
    {
        await using var fixture = await Fixture.CreateAsync();
        var dataset = await fixture.AddDatasetAsync("customers", analyzed: false);
        dataset.Status = "Deployed";
        dataset.AnalysisResultJson = "{\"clientStatus\":\"complete\"}";
        await fixture.Context.SaveChangesAsync();

        var first = await fixture.Service.EvaluateAsync(fixture.ProjectId);
        fixture.Context.ChangeTracker.Clear();
        var reconstructed = await new ProjectWorkflowService(fixture.Context).EvaluateAsync(fixture.ProjectId);

        Assert.Equal(ProjectWorkflowStates.NeedsAnalysis, first.WorkflowState);
        Assert.Equal(JsonSerializer.Serialize(first), JsonSerializer.Serialize(reconstructed));
    }

    [Fact]
    public async Task CentralGuardsReturnTheCalculatedBlockers()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.AddDatasetAsync("customers", analyzed: false);

        var clean = await Assert.ThrowsAsync<ProjectWorkflowBlockedException>(() => fixture.Service.EnsureCanCleanAsync(fixture.ProjectId));
        var schema = await Assert.ThrowsAsync<ProjectWorkflowBlockedException>(() => fixture.Service.EnsureCanBuildSchemaAsync(fixture.ProjectId));
        var export = await Assert.ThrowsAsync<ProjectWorkflowBlockedException>(() => fixture.Service.EnsureCanExportAsync(fixture.ProjectId));
        var deploy = await Assert.ThrowsAsync<ProjectWorkflowBlockedException>(() => fixture.Service.EnsureCanDeployAsync(fixture.ProjectId));

        Assert.All(new[] { clean, schema, export, deploy }, exception => Assert.Contains("analysis_required", exception.BlockerCodes));
    }

    [Fact]
    public async Task SchemaGenerationAndExportUseCentralWorkflowGuards()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.AddDatasetAsync("customers", analyzed: true);
        var designService = BuildDesignService(fixture.Context, fixture.Service);

        var generation = await Assert.ThrowsAsync<ProjectWorkflowBlockedException>(() =>
            designService.GenerateSchemaAsync(fixture.ProjectId, fixture.UserId, null));
        Assert.Contains("quality_confirmation_required", generation.BlockerCodes);

        await fixture.ConfirmCurrentVersionsAsync();
        await fixture.AddSchemaAsync(DesignStatus.Invalid);
        var export = await Assert.ThrowsAsync<ProjectWorkflowBlockedException>(() =>
            designService.PrepareExportArtifactsAsync(fixture.ProjectId));
        Assert.Contains("schema_invalid", export.BlockerCodes);
    }

    private static DesignService BuildDesignService(ForgeDbContext context, ProjectWorkflowService workflow) => new(
        new DesignRepository(context),
        new DatasetRepository(context),
        new DesignSchemaGeneratorResolver([new SqlSchemaGenerator(), new DbmlGenerator(), new JsonSchemaGenerator()]),
        new DesignValidationService(),
        new CleaningRepository(context),
        workflow);

    private static ControllerContext ControllerContextFor(int userId)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "TestAuth");
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
        };
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private Fixture(ForgeDbContext context, int userId, int projectId)
        {
            Context = context;
            UserId = userId;
            ProjectId = projectId;
            Service = new ProjectWorkflowService(context);
        }

        public ForgeDbContext Context { get; }
        public ProjectWorkflowService Service { get; }
        public int UserId { get; }
        public int ProjectId { get; }

        public static async Task<Fixture> CreateAsync()
        {
            var context = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
            var user = new User
            {
                FirstName = "Workflow",
                LastName = "Owner",
                Email = $"{Guid.NewGuid()}@example.com",
                PasswordHash = "x",
                Role = "User",
                CreatedAt = DateTime.UtcNow
            };
            var project = new Project { Name = "Workflow project", User = user, CreatedAt = DateTime.UtcNow };
            context.Projects.Add(project);
            await context.SaveChangesAsync();
            return new Fixture(context, user.Id, project.Id);
        }

        public async Task<Dataset> AddDatasetAsync(string name, bool analyzed, bool cleaned = false)
        {
            var dataset = new Dataset
            {
                ProjectId = ProjectId,
                TableName = name,
                SourceType = "csv",
                Status = analyzed ? "Analyzed" : "Imported",
                RowCount = 2,
                ColumnCount = 1,
                CreatedAt = DateTime.UtcNow
            };
            Context.Datasets.Add(dataset);
            await Context.SaveChangesAsync();
            var versionOne = NewVersion(dataset.Id, 1, isRaw: true, analyzed: cleaned || analyzed);
            versionOne.IsActive = !cleaned;
            Context.DatasetVersions.Add(versionOne);
            await Context.SaveChangesAsync();

            DatasetVersion active = versionOne;
            if (cleaned)
            {
                active = NewVersion(dataset.Id, 2, isRaw: false, analyzed: analyzed);
                active.ParentVersionId = versionOne.Id;
                Context.DatasetVersions.Add(active);
                await Context.SaveChangesAsync();
            }

            dataset.ActiveVersionId = active.Id;
            dataset.AnalysisResultJson = active.AnalysisResultJson;
            dataset.AnalyzedAt = active.AnalyzedAt;
            await Context.SaveChangesAsync();
            return dataset;
        }

        public async Task ActivateNewVersionAsync(int datasetId, bool analyzed)
        {
            var dataset = await Context.Datasets.Include(item => item.Versions).SingleAsync(item => item.Id == datasetId);
            foreach (var version in dataset.Versions) version.IsActive = false;
            await Context.SaveChangesAsync();
            var next = NewVersion(dataset.Id, dataset.Versions.Max(version => version.VersionNumber) + 1, isRaw: false, analyzed: analyzed);
            next.ParentVersionId = dataset.ActiveVersionId;
            Context.DatasetVersions.Add(next);
            await Context.SaveChangesAsync();
            dataset.ActiveVersionId = next.Id;
            dataset.AnalysisResultJson = next.AnalysisResultJson;
            dataset.AnalyzedAt = next.AnalyzedAt;
            await Context.SaveChangesAsync();
        }

        public async Task ConfirmCurrentVersionsAsync()
        {
            var versions = await Context.Datasets
                .Where(dataset => dataset.ProjectId == ProjectId && dataset.ActiveVersionId.HasValue)
                .ToDictionaryAsync(dataset => dataset.Id, dataset => dataset.ActiveVersionId!.Value);
            await ConfirmVersionsAsync(versions);
        }

        public async Task ConfirmVersionsAsync(Dictionary<int, int> versions)
        {
            var state = await Context.ProjectCleaningStates.SingleOrDefaultAsync(item => item.ProjectId == ProjectId);
            if (state is null)
            {
                state = new ProjectCleaningState { ProjectId = ProjectId };
                Context.ProjectCleaningStates.Add(state);
            }
            state.QualityConfirmedAt = DateTime.UtcNow;
            state.QualityConfirmedByUserId = UserId;
            state.ConfirmedVersionsJson = JsonSerializer.Serialize(versions);
            state.UpdatedAt = DateTime.UtcNow;
            await Context.SaveChangesAsync();
        }

        public async Task<DesignModel> AddSchemaAsync(string status)
        {
            var design = new DesignModel
            {
                ProjectId = ProjectId,
                Revision = 4,
                Status = status,
                ValidatedAt = status == DesignStatus.Valid ? DateTime.UtcNow : null,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            var datasets = await Context.Datasets
                .Where(dataset => dataset.ProjectId == ProjectId)
                .OrderBy(dataset => dataset.Id)
                .ToListAsync();
            foreach (var dataset in datasets)
            {
                design.Tables.Add(new DesignTable
                {
                    Name = dataset.TableName,
                    Origin = DesignOrigin.Generated,
                    SourceDatasetId = dataset.Id,
                    SourceDatasetVersionId = dataset.ActiveVersionId
                });
            }
            Context.DesignModels.Add(design);
            await Context.SaveChangesAsync();
            return design;
        }

        private DatasetVersion NewVersion(int datasetId, int number, bool isRaw, bool analyzed) => new()
        {
            DatasetId = datasetId,
            CreatedByUserId = UserId,
            VersionNumber = number,
            IsRawOriginal = isRaw,
            IsActive = true,
            RowsJson = "[{\"id\":1},{\"id\":2}]",
            ColumnsJson = "[{\"name\":\"id\",\"dataType\":\"integer\"}]",
            RowCount = 2,
            ColumnCount = 1,
            OperationSummary = isRaw ? "Imported" : "Cleaned",
            AnalysisResultJson = analyzed ? "{\"rowCount\":2,\"columns\":[]}" : null,
            AnalyzedAt = analyzed ? DateTime.UtcNow : null,
            CreatedAt = DateTime.UtcNow
        };

        public ValueTask DisposeAsync() => Context.DisposeAsync();
    }
}
