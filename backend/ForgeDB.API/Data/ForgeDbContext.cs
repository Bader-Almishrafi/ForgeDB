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
    public DbSet<DatabaseSchema> DatabaseSchemas => Set<DatabaseSchema>();
    public DbSet<DatabaseDeployment> DatabaseDeployments => Set<DatabaseDeployment>();

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

            entity.HasMany(project => project.DatabaseSchemas)
                .WithOne(schema => schema.Project)
                .HasForeignKey(schema => schema.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(project => project.DatabaseDeployments)
                .WithOne(deployment => deployment.Project)
                .HasForeignKey(deployment => deployment.ProjectId)
                .OnDelete(DeleteBehavior.Restrict);
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

            entity.HasMany(dataset => dataset.DatabaseSchemas)
                .WithOne(schema => schema.Dataset)
                .HasForeignKey(schema => schema.DatasetId)
                .OnDelete(DeleteBehavior.Restrict);
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

        modelBuilder.Entity<DatabaseSchema>(entity =>
        {
            entity.ToTable("database_schemas");
            entity.HasKey(schema => schema.Id);
            entity.Property(schema => schema.SchemaJson).HasColumnType("jsonb");
            entity.Property(schema => schema.RelationshipsJson).HasColumnType("jsonb");

            entity.HasMany(schema => schema.Deployments)
                .WithOne(deployment => deployment.Schema)
                .HasForeignKey(deployment => deployment.SchemaId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DatabaseDeployment>(entity =>
        {
            entity.ToTable("database_deployments");
            entity.HasKey(deployment => deployment.Id);
        });
    }
}

