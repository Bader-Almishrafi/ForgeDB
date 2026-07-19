using ForgeDB.API.Models.Entities;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Data;

public class ForgeDbContext : DbContext
{
    public ForgeDbContext(DbContextOptions<ForgeDbContext> options)
        : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Dataset> Datasets => Set<Dataset>();
    public DbSet<DatasetColumn> DatasetColumns => Set<DatasetColumn>();
    public DbSet<DatasetRow> DatasetRows => Set<DatasetRow>();
    public DbSet<DatasetVersion> DatasetVersions => Set<DatasetVersion>();
    public DbSet<CleaningBatch> CleaningBatches => Set<CleaningBatch>();
    public DbSet<CleaningOperation> CleaningOperations => Set<CleaningOperation>();
    public DbSet<ProjectCleaningState> ProjectCleaningStates => Set<ProjectCleaningState>();
    public DbSet<DesignModel> DesignModels => Set<DesignModel>();
    public DbSet<DesignTable> DesignTables => Set<DesignTable>();
    public DbSet<DesignColumn> DesignColumns => Set<DesignColumn>();
    public DbSet<DesignRelationship> DesignRelationships => Set<DesignRelationship>();
    public DbSet<RelationshipSuggestion> RelationshipSuggestions => Set<RelationshipSuggestion>();
    public DbSet<Deployment> Deployments => Set<Deployment>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(user => user.Id);
            entity.HasIndex(user => user.Email).IsUnique();

            entity.HasMany(user => user.Projects)
                .WithOne(project => project.User)
                .HasForeignKey(project => project.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PasswordResetToken>(entity =>
        {
            entity.ToTable("password_reset_tokens");
            entity.HasKey(token => token.Id);
            entity.Property(token => token.TokenHash).HasMaxLength(64).IsRequired();
            entity.HasIndex(token => token.TokenHash).IsUnique();
            entity.HasIndex(token => new { token.UserId, token.ExpiresAt });

            entity.HasOne(token => token.User)
                .WithMany(user => user.PasswordResetTokens)
                .HasForeignKey(token => token.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Project>(entity =>
        {
            entity.ToTable("projects");
            entity.HasKey(project => project.Id);
            entity.Property(project => project.DashboardConfig).HasColumnType("jsonb");

            entity.HasMany(project => project.Datasets)
                .WithOne(dataset => dataset.Project)
                .HasForeignKey(dataset => dataset.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Dataset>(entity =>
        {
            entity.ToTable("datasets");
            entity.HasKey(dataset => dataset.Id);
            entity.Property(dataset => dataset.AnalysisResultJson).HasColumnType("jsonb");

            entity.HasMany(dataset => dataset.Columns)
                .WithOne(column => column.Dataset)
                .HasForeignKey(column => column.DatasetId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(dataset => dataset.Rows)
                .WithOne(row => row.Dataset)
                .HasForeignKey(row => row.DatasetId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(dataset => dataset.Versions)
                .WithOne(version => version.Dataset)
                .HasForeignKey(version => version.DatasetId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(dataset => dataset.ActiveVersion)
                .WithMany()
                .HasForeignKey(dataset => dataset.ActiveVersionId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<DatasetColumn>(entity =>
        {
            entity.ToTable("dataset_columns");
            entity.HasKey(column => column.Id);
            entity.Property(column => column.SampleValues).HasColumnType("jsonb");
        });

        modelBuilder.Entity<DatasetRow>(entity =>
        {
            entity.ToTable("dataset_rows");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.RowData).HasColumnType("jsonb");
        });

        modelBuilder.Entity<DatasetVersion>(entity =>
        {
            entity.ToTable("dataset_versions");
            entity.HasKey(version => version.Id);
            entity.Property(version => version.RowsJson).HasColumnType("jsonb");
            entity.Property(version => version.ColumnsJson).HasColumnType("jsonb");
            entity.Property(version => version.AnalysisResultJson).HasColumnType("jsonb");
            entity.HasIndex(version => new { version.DatasetId, version.VersionNumber }).IsUnique();
            entity.HasIndex(version => version.DatasetId)
                .HasDatabaseName("IX_dataset_versions_DatasetId_Active")
                .IsUnique()
                .HasFilter("\"IsActive\" = TRUE");

            entity.HasOne(version => version.ParentVersion)
                .WithMany(version => version.ChildVersions)
                .HasForeignKey(version => version.ParentVersionId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(version => version.CleaningBatch)
                .WithMany(batch => batch.ProducedVersions)
                .HasForeignKey(version => version.CleaningBatchId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(version => version.CreatedByUser)
                .WithMany()
                .HasForeignKey(version => version.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<CleaningBatch>(entity =>
        {
            entity.ToTable("cleaning_batches");
            entity.HasKey(batch => batch.Id);
            entity.Property(batch => batch.FailureDetailsJson).HasColumnType("jsonb");
            entity.HasIndex(batch => batch.CorrelationId).IsUnique();
            entity.HasIndex(batch => new { batch.ProjectId, batch.CreatedAt });

            entity.HasOne(batch => batch.Project)
                .WithMany(project => project.CleaningBatches)
                .HasForeignKey(batch => batch.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(batch => batch.CreatedByUser)
                .WithMany()
                .HasForeignKey(batch => batch.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(batch => batch.Operations)
                .WithOne(operation => operation.CleaningBatch)
                .HasForeignKey(operation => operation.CleaningBatchId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<CleaningOperation>(entity =>
        {
            entity.ToTable("cleaning_operations");
            entity.HasKey(operation => operation.Id);
            entity.Property(operation => operation.ParametersJson).HasColumnType("jsonb");
            entity.HasIndex(operation => operation.CleaningBatchId);
            entity.HasIndex(operation => operation.DatasetId);

            entity.HasOne(operation => operation.Dataset)
                .WithMany()
                .HasForeignKey(operation => operation.DatasetId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(operation => operation.SourceVersion)
                .WithMany()
                .HasForeignKey(operation => operation.SourceVersionId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(operation => operation.ResultVersion)
                .WithMany()
                .HasForeignKey(operation => operation.ResultVersionId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<ProjectCleaningState>(entity =>
        {
            entity.ToTable("project_cleaning_states");
            entity.HasKey(state => state.ProjectId);
            entity.Property(state => state.ConfirmedVersionsJson).HasColumnType("jsonb");

            entity.HasOne(state => state.Project)
                .WithOne(project => project.CleaningState)
                .HasForeignKey<ProjectCleaningState>(state => state.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(state => state.LastCleaningBatch)
                .WithMany()
                .HasForeignKey(state => state.LastCleaningBatchId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(state => state.QualityConfirmedByUser)
                .WithMany()
                .HasForeignKey(state => state.QualityConfirmedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<DesignModel>(entity =>
        {
            entity.ToTable("design_models");
            entity.HasKey(design => design.Id);
            entity.Property(design => design.LayoutJson).HasColumnType("jsonb");
            entity.Property(design => design.SourceVersionsJson).HasColumnType("jsonb");
            entity.Property(design => design.Status).HasMaxLength(16).IsRequired();
            entity.Property(design => design.Revision).IsConcurrencyToken();
            entity.HasIndex(design => design.ProjectId).IsUnique();

            entity.HasOne(design => design.Project)
                .WithOne(project => project.Design)
                .HasForeignKey<DesignModel>(design => design.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(design => design.LastModifiedByUser)
                .WithMany()
                .HasForeignKey(design => design.LastModifiedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(design => design.Tables)
                .WithOne(table => table.DesignModel)
                .HasForeignKey(table => table.DesignModelId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(design => design.Relationships)
                .WithOne(relationship => relationship.DesignModel)
                .HasForeignKey(relationship => relationship.DesignModelId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DesignTable>(entity =>
        {
            entity.ToTable("design_tables");
            entity.HasKey(table => table.Id);
            entity.Property(table => table.Name).HasMaxLength(128).IsRequired();
            entity.HasIndex(table => table.DesignModelId);
            entity.HasIndex(table => table.SourceDatasetId);
            entity.HasIndex(table => table.SourceDatasetVersionId);

            entity.HasOne(table => table.SourceDataset)
                .WithMany()
                .HasForeignKey(table => table.SourceDatasetId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(table => table.SourceDatasetVersion)
                .WithMany()
                .HasForeignKey(table => table.SourceDatasetVersionId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasMany(table => table.Columns)
                .WithOne(column => column.DesignTable)
                .HasForeignKey(column => column.DesignTableId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DesignColumn>(entity =>
        {
            entity.ToTable("design_columns");
            entity.HasKey(column => column.Id);
            entity.Property(column => column.Name).HasMaxLength(128).IsRequired();
            entity.Property(column => column.SqlType).HasMaxLength(64).IsRequired();
            entity.Property(column => column.DefaultValue).HasMaxLength(512);
            entity.HasIndex(column => column.DesignTableId);
        });

        modelBuilder.Entity<DesignRelationship>(entity =>
        {
            entity.ToTable("design_relationships");
            entity.HasKey(relationship => relationship.Id);
            entity.HasIndex(relationship => relationship.DesignModelId);
            entity.HasIndex(relationship => new
            {
                relationship.DesignModelId,
                relationship.FromColumnId,
                relationship.ToColumnId,
                relationship.Cardinality
            })
                .HasDatabaseName(Services.Validation.DesignRelationshipRules.UniqueIndexName)
                .IsUnique();
            entity.HasIndex(relationship => relationship.FromColumnId);
            entity.HasIndex(relationship => relationship.ToColumnId);
            entity.HasIndex(relationship => relationship.SuggestionId);

            // FromColumn/ToColumn use Restrict (not Cascade) to avoid a second cascade path to
            // this table alongside DesignModel's own cascade (DesignModel -> DesignTable ->
            // DesignColumn would otherwise reach DesignRelationship a second way). Column and
            // table delete service methods explicitly remove dependent relationships in the same
            // transaction instead; see DesignService.
            entity.HasOne(relationship => relationship.FromColumn)
                .WithMany()
                .HasForeignKey(relationship => relationship.FromColumnId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(relationship => relationship.ToColumn)
                .WithMany()
                .HasForeignKey(relationship => relationship.ToColumnId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(relationship => relationship.Suggestion)
                .WithMany(suggestion => suggestion.DesignRelationships)
                .HasForeignKey(relationship => relationship.SuggestionId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RelationshipSuggestion>(entity =>
        {
            entity.ToTable("relationship_suggestions");
            entity.HasKey(suggestion => suggestion.Id);
            entity.Property(suggestion => suggestion.EvidenceJson).HasColumnType("jsonb");
            entity.HasIndex(suggestion => suggestion.TargetDatasetId);
            entity.HasIndex(suggestion => new
            {
                suggestion.ProjectId,
                suggestion.SourceDatasetId,
                suggestion.SourceColumnName,
                suggestion.TargetDatasetId,
                suggestion.TargetColumnName
            }).IsUnique();

            entity.HasOne(suggestion => suggestion.Project)
                .WithMany(project => project.RelationshipSuggestions)
                .HasForeignKey(suggestion => suggestion.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(suggestion => suggestion.SourceDataset)
                .WithMany()
                .HasForeignKey(suggestion => suggestion.SourceDatasetId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(suggestion => suggestion.TargetDataset)
                .WithMany()
                .HasForeignKey(suggestion => suggestion.TargetDatasetId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Deployment>(entity =>
        {
            entity.ToTable("deployments");
            entity.HasKey(deployment => deployment.Id);
            entity.Property(deployment => deployment.CreatedTablesJson).HasColumnType("jsonb");
            entity.Property(deployment => deployment.InsertedRowCountsJson).HasColumnType("jsonb");
            entity.Property(deployment => deployment.GeneratedSql).HasColumnType("text");
            entity.Property(deployment => deployment.SeedSql).HasColumnType("text");
            entity.Property(deployment => deployment.DeploySql).HasColumnType("text");
            entity.HasIndex(deployment => new { deployment.ProjectId, deployment.StartedAt });

            entity.HasOne(deployment => deployment.Project)
                .WithMany()
                .HasForeignKey(deployment => deployment.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
