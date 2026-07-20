using System.Reflection;
using System.Text.Json;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Tests.Services;

public class DeploymentServiceTests
{
    [Fact]
    public async Task DeployAsync_UsesApprovedCleanedVersionRows_NotRawUploadRows()
    {
        var fixture = CreateFixture(cleanedValue: "cleaned-final-value");

        var response = await fixture.Service.DeployAsync(8, 3, 6);

        Assert.Equal(2, fixture.RequestedVersionId);
        Assert.NotNull(fixture.CapturedPlans);
        Assert.Equal("cleaned-final-value", fixture.CapturedPlans![0].Rows[0][0]);
        Assert.DoesNotContain("raw-original-value", fixture.StoredDeployment!.SeedSql, StringComparison.Ordinal);
        Assert.Contains("cleaned-final-value", fixture.StoredDeployment.SeedSql, StringComparison.Ordinal);
        Assert.Equal(DeploymentStatus.Completed, response.Status);
        Assert.Equal(1, response.RowsSeeded);
        Assert.True(response.SchemaSqlAvailable && response.SeedSqlAvailable && response.DeploySqlAvailable);
    }

    [Fact]
    public async Task DeployAsync_RejectsRawOriginalVersion_WithoutCreatingCompletedRecord()
    {
        var fixture = CreateFixture(cleanedValue: "raw-original-value", isRawOriginal: true);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Service.DeployAsync(8, 3, 6));

        Assert.Contains("Raw uploaded data cannot be deployed", exception.Message);
        Assert.Null(fixture.StoredDeployment);
    }

    [Fact]
    public async Task DeployAsync_RejectsSchemaMappedToStaleVersionOne()
    {
        var fixture = CreateFixture("stale-value", activeVersionId: 3);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Service.DeployAsync(8, 3, 6));

        Assert.Contains("stale dataset version", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Null(fixture.StoredDeployment);
    }

    [Fact]
    public async Task DeployAsync_DoesNotCreateCompletedRecord_WhenSeedGenerationCannotConvertFinalizedValue()
    {
        var fixture = CreateFixture(cleanedValue: "not-an-integer", sqlType: "INTEGER");

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Service.DeployAsync(8, 3, 6));

        Assert.Contains("cannot be converted", exception.Message);
        Assert.Null(fixture.StoredDeployment);
    }

    [Fact]
    public async Task DeployAsync_PreservesFinalizedIdentityValues_AndSynchronizesSequence()
    {
        var fixture = CreateFixture(cleanedValue: "41", sqlType: "INTEGER", isAutoIncrement: true);

        await fixture.Service.DeployAsync(8, 3, 6);

        Assert.Equal(new[] { "name" }, fixture.CapturedPlans![0].IdentityColumnNames);
        Assert.Equal(41, fixture.CapturedPlans[0].Rows[0][0]);
        Assert.Contains("pg_get_serial_sequence", fixture.StoredDeployment!.SeedSql);
        Assert.Contains("MAX(\"name\")", fixture.StoredDeployment.SeedSql);
    }

    [Fact]
    public async Task DeployAsync_RejectsUserWhoDoesNotOwnProject_BeforeReadingSchemaOrData()
    {
        var deploymentRepository = Proxy<IDeploymentRepository>(new()
        {
            [nameof(IDeploymentRepository.GetOwnedProjectAsync)] = _ => Task.FromResult<Project?>(null)
        });
        var designRepository = Proxy<IDesignRepository>(new());
        var designService = Proxy<IDesignService>(new());
        var cleaningRepository = Proxy<ICleaningRepository>(new());
        var service = new DeploymentService(deploymentRepository, designRepository, designService, cleaningRepository);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.DeployAsync(8, 999, 6));
    }

    [Fact]
    public async Task DeployAsync_UsesCentralWorkflowGuardBeforeReadingSchemaOrData()
    {
        var deploymentRepository = Proxy<IDeploymentRepository>(new()
        {
            [nameof(IDeploymentRepository.GetOwnedProjectAsync)] = _ => Task.FromResult<Project?>(new Project { Id = 8, UserId = 3 })
        });
        var workflow = Proxy<IProjectWorkflowService>(new()
        {
            [nameof(IProjectWorkflowService.EnsureCanDeployAsync)] = _ => throw new ProjectWorkflowBlockedException(
                "deploy",
                new ProjectWorkflowResponseDto
                {
                    BlockerCodes = ["schema_stale"],
                    BlockingReasons = ["The schema references dataset versions that are no longer active."]
                })
        });
        var service = new DeploymentService(
            deploymentRepository,
            Proxy<IDesignRepository>(new()),
            Proxy<IDesignService>(new()),
            Proxy<ICleaningRepository>(new()),
            logger: null,
            workflowService: workflow);

        var exception = await Assert.ThrowsAsync<ProjectWorkflowBlockedException>(() => service.DeployAsync(8, 3, 6));

        Assert.Contains("schema_stale", exception.BlockerCodes);
    }

    [Fact]
    public async Task DeployAsync_PersistsFailedStatus_WhenDatabaseExecutionRollsBack()
    {
        var fixture = CreateFixture(cleanedValue: "cleaned", executionFailure: new InvalidOperationException("constraint failure"));

        var response = await fixture.Service.DeployAsync(8, 3, 6);

        Assert.Equal(DeploymentStatus.Failed, response.Status);
        Assert.Equal(0, response.TablesCreated);
        Assert.Equal(0, response.RowsSeeded);
        Assert.Equal(1, response.FailedRows);
        Assert.Contains("constraint failure", response.ErrorMessage);
    }

    private static DeploymentServiceFixture CreateFixture(
        string cleanedValue,
        bool isRawOriginal = false,
        string sqlType = "TEXT",
        bool isAutoIncrement = false,
        Exception? executionFailure = null,
        int? activeVersionId = null)
    {
        const int projectId = 8;
        const int datasetId = 12;
        var versionId = activeVersionId.HasValue ? 1 : 2;

        var table = new DesignTable
        {
            Id = 20,
            DesignModelId = 4,
            Name = "customers",
            Origin = DesignOrigin.Generated,
            SourceDatasetId = datasetId,
            SourceDatasetVersionId = versionId,
        };
        table.Columns.Add(new DesignColumn
        {
            Id = 21,
            DesignTableId = table.Id,
            DesignTable = table,
            Name = "name",
            SqlType = sqlType,
            SourceColumnName = "name",
            IsNullable = false,
            IsAutoIncrement = isAutoIncrement,
            Ordinal = 0,
            Origin = DesignOrigin.Generated,
        });
        var design = new DesignModel
        {
            Id = 4,
            ProjectId = projectId,
            Revision = 6,
            Status = DesignStatus.Valid,
            ValidatedAt = DateTime.UtcNow,
            Tables = new List<DesignTable> { table },
        };
        var version = new DatasetVersion
        {
            Id = versionId,
            DatasetId = datasetId,
            VersionNumber = versionId,
            IsRawOriginal = isRawOriginal,
            IsActive = true,
            AnalyzedAt = DateTime.UtcNow,
            ColumnsJson = JsonSerializer.Serialize(new[] { new { name = "name", dataType = "string" } }),
            RowsJson = JsonSerializer.Serialize(new[] { new Dictionary<string, object?> { ["name"] = cleanedValue } }),
            RowCount = 1,
        };
        var currentActiveVersion = activeVersionId is null || activeVersionId == versionId
            ? version
            : new DatasetVersion
            {
                Id = activeVersionId.Value,
                DatasetId = datasetId,
                VersionNumber = 3,
                IsActive = true,
                AnalyzedAt = DateTime.UtcNow,
                ColumnsJson = version.ColumnsJson,
                RowsJson = version.RowsJson,
                RowCount = version.RowCount
            };

        Deployment? storedDeployment = null;
        IReadOnlyList<TableInsertPlan>? capturedPlans = null;
        var requestedVersionId = 0;
        var deploymentRepository = Proxy<IDeploymentRepository>(new()
        {
            [nameof(IDeploymentRepository.GetOwnedProjectAsync)] = _ => Task.FromResult<Project?>(new Project { Id = projectId, UserId = 3 }),
            [nameof(IDeploymentRepository.AddRunningAsync)] = args =>
            {
                storedDeployment = (Deployment)args![0]!;
                storedDeployment.Id = 90;
                return Task.FromResult(storedDeployment);
            },
            [nameof(IDeploymentRepository.ExecuteDeploymentTransactionAsync)] = args =>
            {
                capturedPlans = (IReadOnlyList<TableInsertPlan>)args![2]!;
                if (executionFailure is not null) throw executionFailure;
                return Task.FromResult(new Dictionary<string, int> { ["customers"] = 1 });
            },
            [nameof(IDeploymentRepository.MarkSucceededAsync)] = args =>
            {
                storedDeployment!.Status = DeploymentStatus.Completed;
                storedDeployment.TablesCreated = 1;
                storedDeployment.TotalRowsInserted = 1;
                storedDeployment.CreatedTablesJson = "[\"customers\"]";
                storedDeployment.InsertedRowCountsJson = "{\"customers\":1}";
                storedDeployment.CompletedAt = DateTime.UtcNow;
                return Task.CompletedTask;
            },
            [nameof(IDeploymentRepository.MarkFailedAsync)] = args =>
            {
                storedDeployment!.Status = DeploymentStatus.Failed;
                storedDeployment.ErrorMessage = (string)args![1]!;
                storedDeployment.FailedRows = (int)args[2]!;
                storedDeployment.CompletedAt = DateTime.UtcNow;
                return Task.CompletedTask;
            },
            [nameof(IDeploymentRepository.GetAsync)] = _ => Task.FromResult(storedDeployment),
        });
        var designRepository = Proxy<IDesignRepository>(new()
        {
            [nameof(IDesignRepository.GetFullByProjectIdAsync)] = _ => Task.FromResult<DesignModel?>(design)
        });
        var designService = Proxy<IDesignService>(new()
        {
            [nameof(IDesignService.PrepareExportArtifactsAsync)] = _ => Task.FromResult<DesignExportArtifacts?>(new DesignExportArtifacts
            {
                DesignId = design.Id,
                Revision = design.Revision,
                Sql = $"BEGIN;\nCREATE TABLE customers (name {sqlType} NOT NULL);\nCOMMIT;\n",
            })
        });
        var cleaningRepository = Proxy<ICleaningRepository>(new()
        {
            [nameof(ICleaningRepository.IsSchemaReadyAsync)] = _ => Task.FromResult(true),
            [nameof(ICleaningRepository.GetActiveProjectVersionsAsync)] = _ => Task.FromResult<IReadOnlyList<CleaningDatasetVersionData>>(
            [
                new CleaningDatasetVersionData(
                    new Dataset { Id = datasetId, ProjectId = projectId, ActiveVersionId = currentActiveVersion.Id, ActiveVersion = currentActiveVersion },
                    currentActiveVersion,
                    [new CleaningColumnSnapshotDto { Name = "name", DataType = "string" }],
                    [new Dictionary<string, object?> { ["name"] = cleanedValue }])
            ]),
            [nameof(ICleaningRepository.GetStateAsync)] = _ => Task.FromResult<ProjectCleaningState?>(new ProjectCleaningState
            {
                ProjectId = projectId,
                QualityConfirmedAt = DateTime.UtcNow,
                ConfirmedVersionsJson = JsonSerializer.Serialize(new Dictionary<int, int> { [datasetId] = versionId })
            }),
            [nameof(ICleaningRepository.GetVersionAsync)] = args =>
            {
                requestedVersionId = (int)args![1]!;
                return Task.FromResult<DatasetVersion?>(version);
            },
        });

        var service = new DeploymentService(deploymentRepository, designRepository, designService, cleaningRepository);
        return new DeploymentServiceFixture(
            service,
            () => storedDeployment,
            () => capturedPlans,
            () => requestedVersionId);
    }

    private static T Proxy<T>(Dictionary<string, Func<object?[]?, object?>> handlers) where T : class
    {
        var proxy = DispatchProxy.Create<T, TestInterfaceProxy<T>>();
        ((TestInterfaceProxy<T>)(object)proxy).Handlers = handlers;
        return proxy;
    }

    private sealed class DeploymentServiceFixture
    {
        private readonly Func<Deployment?> _storedDeployment;
        private readonly Func<IReadOnlyList<TableInsertPlan>?> _capturedPlans;
        private readonly Func<int> _requestedVersionId;

        public DeploymentServiceFixture(
            DeploymentService service,
            Func<Deployment?> storedDeployment,
            Func<IReadOnlyList<TableInsertPlan>?> capturedPlans,
            Func<int> requestedVersionId)
        {
            Service = service;
            _storedDeployment = storedDeployment;
            _capturedPlans = capturedPlans;
            _requestedVersionId = requestedVersionId;
        }

        public DeploymentService Service { get; }
        public Deployment? StoredDeployment => _storedDeployment();
        public IReadOnlyList<TableInsertPlan>? CapturedPlans => _capturedPlans();
        public int RequestedVersionId => _requestedVersionId();
    }
}

public class TestInterfaceProxy<T> : DispatchProxy where T : class
{
    public Dictionary<string, Func<object?[]?, object?>> Handlers { get; set; } = new();

    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        if (targetMethod is not null && Handlers.TryGetValue(targetMethod.Name, out var handler))
        {
            return handler(args);
        }

        throw new InvalidOperationException($"Unexpected call to {typeof(T).Name}.{targetMethod?.Name}.");
    }
}
