using ForgeDB.API.Configuration;

var builder = WebApplication.CreateBuilder(args);

// Register controllers and foundational infrastructure via modular architectural extensions (SRP & OCP)
builder.Services.AddControllers();
builder.Services
    .AddDatabaseServices(builder.Configuration)
    .AddCorsAndForwardingServices(builder.Configuration)
    .AddApplicationRepositories()
    .AddApplicationServices(builder.Configuration)
    .AddSecurityServices(builder.Configuration);

var app = builder.Build();

// Initialize persistent data schemas cleanly during startup
await app.ApplyDatabaseMigrationsAsync();

// Configure defensive HTTP middleware pipeline and cross-origin policies
app.UseGlobalExceptionHandler();
app.UseForwardedHeaders();
app.UseHttpsRedirection();

app.UseCors("Frontend");

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
