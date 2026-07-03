using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Repositories;

public class SchemaRepository : ISchemaRepository
{
    private readonly ForgeDbContext _context;

    public SchemaRepository(ForgeDbContext context)
    {
        _context = context;
    }

    public Task<DatabaseSchema?> GetByIdAsync(int schemaId, CancellationToken cancellationToken = default)
    {
        return _context.DatabaseSchemas
            .AsNoTracking()
            .FirstOrDefaultAsync(schema => schema.Id == schemaId, cancellationToken);
    }

    public async Task AddAsync(DatabaseSchema schema, CancellationToken cancellationToken = default)
    {
        await _context.DatabaseSchemas.AddAsync(schema, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task<DatabaseSchema?> UpdateRelationshipsAsync(
        int schemaId,
        string relationshipsJson,
        string schemaJson,
        string sqlContent,
        DateTime updatedAt,
        CancellationToken cancellationToken = default)
    {
        var schema = await _context.DatabaseSchemas
            .FirstOrDefaultAsync(schema => schema.Id == schemaId, cancellationToken);

        if (schema is null)
        {
            return null;
        }

        schema.RelationshipsJson = relationshipsJson;
        schema.SchemaJson = schemaJson;
        schema.SqlContent = sqlContent;
        schema.UpdatedAt = updatedAt;

        await _context.SaveChangesAsync(cancellationToken);

        return schema;
    }
}
