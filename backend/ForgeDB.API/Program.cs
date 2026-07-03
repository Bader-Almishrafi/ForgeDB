using ForgeDB.API.Clients;
using ForgeDB.API.Data;
using ForgeDB.API.Repositories;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using System.Text;

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
builder.Services.AddScoped<IPasswordHasher<ForgeDB.API.Models.Entities.User>, PasswordHasher<ForgeDB.API.Models.Entities.User>>();

var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey))
{
	throw new InvalidOperationException("Jwt:Key configuration is required.");
}

if (jwtKey.Length < 32)
{
	throw new InvalidOperationException("Jwt:Key must be at least 32 characters.");
}

var jwtIssuer = builder.Configuration["Jwt:Issuer"];
if (string.IsNullOrWhiteSpace(jwtIssuer))
{
	throw new InvalidOperationException("Jwt:Issuer configuration is required.");
}

var jwtAudience = builder.Configuration["Jwt:Audience"];
if (string.IsNullOrWhiteSpace(jwtAudience))
{
	throw new InvalidOperationException("Jwt:Audience configuration is required.");
}

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
	.AddJwtBearer(options =>
	{
		options.TokenValidationParameters = new TokenValidationParameters
		{
			ValidateIssuer = true,
			ValidateAudience = true,
			ValidateLifetime = true,
			ValidateIssuerSigningKey = true,
			ValidIssuer = jwtIssuer,
			ValidAudience = jwtAudience,
			IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
		};
	});

builder.Services.AddAuthorization();

var app = builder.Build();

app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();


app.MapControllers();

app.Run();
