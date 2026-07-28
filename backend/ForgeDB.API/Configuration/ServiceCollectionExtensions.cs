using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using ForgeDB.API.Clients;
using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Generators;
using ForgeDB.API.Services.Importing;
using ForgeDB.API.Services.Interfaces;
using ForgeDB.API.Services.Validation;

namespace ForgeDB.API.Configuration;

// Encapsulates standard service dependency registrations into cohesive architecture modules
// following Clean Code and SOLID (Single Responsibility & Open/Closed) engineering principles.
public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddDatabaseServices(this IServiceCollection services, IConfiguration configuration)
    {
        var databaseConnectionString = DatabaseConnectionStringResolver.Resolve(configuration);

        services.AddDbContext<ForgeDbContext>(options =>
            options.UseNpgsql(databaseConnectionString));

        return services;
    }

    public static IServiceCollection AddCorsAndForwardingServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            options.KnownNetworks.Clear();
            options.KnownProxies.Clear();
        });

        var allowedOrigins = configuration
            .GetSection("Cors:AllowedOrigins")
            .Get<string[]>()
            ?? new[] { "http://localhost:4200", "http://127.0.0.1:4200" };

        services.AddCors(options =>
        {
            options.AddPolicy("Frontend", policy =>
            {
                policy
                    .WithOrigins(allowedOrigins)
                    .AllowAnyHeader()
                    .AllowAnyMethod();
            });
        });

        return services;
    }

    public static IServiceCollection AddApplicationRepositories(this IServiceCollection services)
    {
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IPasswordResetTokenRepository, PasswordResetTokenRepository>();
        services.AddScoped<IProjectRepository, ProjectRepository>();
        services.AddScoped<IDatasetRepository, DatasetRepository>();
        services.AddScoped<ICleaningRepository, CleaningRepository>();
        services.AddScoped<IDesignRepository, DesignRepository>();
        services.AddScoped<IRelationshipSuggestionRepository, RelationshipSuggestionRepository>();
        services.AddScoped<IDeploymentRepository, DeploymentRepository>();

        return services;
    }

    public static IServiceCollection AddApplicationServices(this IServiceCollection services, IConfiguration configuration)
    {
        // Core application workflows & services
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IProjectService, ProjectService>();
        services.AddScoped<IProjectWorkflowService, ProjectWorkflowService>();
        services.AddScoped<IDatasetImportService, DatasetImportService>();
        services.AddScoped<IApiJsonImportService, ApiJsonImportService>();
        services.AddScoped<IDashboardService, DashboardService>();
        services.AddScoped<ICleaningService, CleaningService>();
        services.AddScoped<IDesignService, DesignService>();
        services.AddScoped<IRelationshipDetectionService, RelationshipDetectionService>();
        services.AddScoped<IDeploymentService, DeploymentService>();

        // Singleton processing components & utilities
        services.AddSingleton<IExcelWorkbookReader, ExcelWorkbookReader>();
        services.AddSingleton<IHostAddressResolver, SystemHostAddressResolver>();
        services.AddSingleton<IDesignValidationService, DesignValidationService>();
        services.AddSingleton<IDesignSchemaGenerator, SqlSchemaGenerator>();
        services.AddSingleton<IDesignSchemaGenerator, DbmlGenerator>();
        services.AddSingleton<IDesignSchemaGenerator, JsonSchemaGenerator>();
        services.AddSingleton<IDesignSchemaGeneratorResolver, DesignSchemaGeneratorResolver>();
        services.AddSingleton(TimeProvider.System);
        services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();

        // Background jobs
        services.AddHostedService<LegacySuggestionBackfillService>();

        // External client configurations
        services.Configure<ApiImportOptions>(configuration.GetSection(ApiImportOptions.SectionName));
        services.AddHttpClient<IApiJsonClient, ApiJsonClient>()
            .ConfigurePrimaryHttpMessageHandler(serviceProvider => SafeApiHttpHandler.Create(
                serviceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<ApiImportOptions>>().Value,
                serviceProvider.GetRequiredService<IHostEnvironment>()));

        services.AddHttpClient<IPythonAnalysisClient, PythonAnalysisClient>(client =>
        {
            var baseUrl = configuration["PythonAnalysis:BaseUrl"];
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                baseUrl = "http://localhost:8002";
            }

            var timeoutSeconds = configuration.GetValue<int?>("PythonAnalysis:TimeoutSeconds") ?? 10;

            client.BaseAddress = new Uri(baseUrl, UriKind.Absolute);
            client.Timeout = TimeSpan.FromSeconds(Math.Max(1, timeoutSeconds));
        });

        return services;
    }

    public static IServiceCollection AddSecurityServices(this IServiceCollection services, IConfiguration configuration)
    {
        var jwtKey = configuration["Jwt:Key"];
        if (string.IsNullOrWhiteSpace(jwtKey))
        {
            throw new InvalidOperationException("Jwt:Key configuration is required.");
        }

        if (jwtKey.Length < 32)
        {
            throw new InvalidOperationException("Jwt:Key must be at least 32 characters.");
        }

        var jwtIssuer = configuration["Jwt:Issuer"];
        if (string.IsNullOrWhiteSpace(jwtIssuer))
        {
            throw new InvalidOperationException("Jwt:Issuer configuration is required.");
        }

        var jwtAudience = configuration["Jwt:Audience"];
        if (string.IsNullOrWhiteSpace(jwtAudience))
        {
            throw new InvalidOperationException("Jwt:Audience configuration is required.");
        }

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
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
                options.Events = new JwtBearerEvents
                {
                    OnChallenge = async context =>
                    {
                        // Authentication failures return consistent JSON shapes matching controller error schemas
                        context.HandleResponse();
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        context.Response.ContentType = "application/json";
                        await context.Response.WriteAsJsonAsync(new
                        {
                            message = "A valid authentication token is required."
                        });
                    }
                };
            });

        services.AddAuthorization();

        return services;
    }
}
