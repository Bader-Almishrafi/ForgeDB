using ForgeDB.API.Clients;
using ForgeDB.API.Data;
using ForgeDB.API.Repositories;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

builder.Services.AddDbContext<ForgeDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IProjectService, ProjectService>();
builder.Services.AddScoped<IDatasetImportService, DatasetImportService>();
builder.Services.AddScoped<ISchemaService, SchemaService>();
builder.Services.AddScoped<IDashboardService, DashboardService>();
builder.Services.AddScoped<IDeploymentService, DeploymentService>();
builder.Services.AddHttpClient<IPythonAnalysisClient, PythonAnalysisClient>();

builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IProjectRepository, ProjectRepository>();
builder.Services.AddScoped<IDatasetRepository, DatasetRepository>();
builder.Services.AddScoped<ISchemaRepository, SchemaRepository>();
builder.Services.AddScoped<IDeploymentRepository, DeploymentRepository>();

var app = builder.Build();

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();
