using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using ForgeDB.API.Data;

namespace ForgeDB.API.Configuration;

// Provides modular extension methods for configuring standard HTTP middleware pipelines
// and performing essential startup workflows such as schema synchronization.
public static class ApplicationBuilderExtensions
{
    public static async Task ApplyDatabaseMigrationsAsync(this WebApplication app)
    {
        if (!app.Configuration.GetValue<bool>("Database:ApplyMigrationsOnStartup"))
        {
            return;
        }

        var migrationLogger = app.Services
            .GetRequiredService<ILoggerFactory>()
            .CreateLogger("DatabaseMigrations");

        migrationLogger.LogInformation("Database migrations started.");

        try
        {
            await using var scope = app.Services.CreateAsyncScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            await dbContext.Database.MigrateAsync();
            migrationLogger.LogInformation("Database migrations succeeded.");
        }
        catch (Exception exception)
        {
            migrationLogger.LogError(exception, "Database migrations failed.");
            throw;
        }
    }

    public static IApplicationBuilder UseGlobalExceptionHandler(this IApplicationBuilder app)
    {
        app.UseExceptionHandler(exceptionHandlerApp =>
        {
            exceptionHandlerApp.Run(async context =>
            {
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                context.Response.ContentType = "application/json";

                var exceptionHandlerPathFeature = context.Features.Get<IExceptionHandlerPathFeature>();
                var exception = exceptionHandlerPathFeature?.Error;

                var errorMessage = exception switch
                {
                    InvalidOperationException invalidOp => invalidOp.Message,
                    ArgumentException argEx => argEx.Message,
                    _ => "An unexpected error occurred on the server while processing your request."
                };

                var responsePayload = new
                {
                    message = errorMessage,
                    status = context.Response.StatusCode
                };

                await context.Response.WriteAsJsonAsync(responsePayload);
            });
        });

        return app;
    }
}
