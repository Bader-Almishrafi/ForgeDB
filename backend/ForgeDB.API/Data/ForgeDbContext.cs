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
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Dataset> Datasets => Set<Dataset>();
    public DbSet<DatasetColumn> DatasetColumns => Set<DatasetColumn>();
    public DbSet<DatasetRow> DatasetRows => Set<DatasetRow>();
    public DbSet<DesignModel> DesignModels => Set<DesignModel>();
    public DbSet<DesignTable> DesignTables => Set<DesignTable>();
    public DbSet<DesignColumn> DesignColumns => Set<DesignColumn>();
    public DbSet<DesignRelationship> DesignRelationships => Set<DesignRelationship>();
    public DbSet<RelationshipSuggestion> RelationshipSuggestions => Set<RelationshipSuggestion>();

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

        modelBuilder.Entity<DesignModel>(entity =>
        {
            entity.ToTable("design_models");
            entity.HasKey(design => design.Id);
            entity.Property(design => design.LayoutJson).HasColumnType("jsonb");
            entity.Property(design => design.Revision).IsConcurrencyToken();
            entity.HasIndex(design => design.ProjectId).IsUnique();

            entity.HasOne(design => design.Project)
                .WithOne(project => project.Design)
                .HasForeignKey<DesignModel>(design => design.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);

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

            entity.HasOne(table => table.SourceDataset)
                .WithMany()
                .HasForeignKey(table => table.SourceDatasetId)
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
            entity.HasIndex(column => column.DesignTableId);
        });

        modelBuilder.Entity<DesignRelationship>(entity =>
        {
            entity.ToTable("design_relationships");
            entity.HasKey(relationship => relationship.Id);
            entity.HasIndex(relationship => relationship.DesignModelId);
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
    }
}

