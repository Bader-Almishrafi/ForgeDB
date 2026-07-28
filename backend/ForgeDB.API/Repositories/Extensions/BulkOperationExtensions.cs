using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Query;

namespace ForgeDB.API.Repositories.Extensions;

public static class BulkOperationExtensions
{
    public static async Task ExecuteDeleteCompatibleAsync<TEntity>(
        this IQueryable<TEntity> query,
        DbContext context,
        CancellationToken cancellationToken = default) where TEntity : class
    {
        if (context.Database.IsRelational())
        {
            await query.ExecuteDeleteAsync(cancellationToken);
            return;
        }

        var entities = await query.ToListAsync(cancellationToken);
        if (entities.Count > 0)
        {
            context.Set<TEntity>().RemoveRange(entities);
            await context.SaveChangesAsync(cancellationToken);
        }
    }

    public static async Task ExecuteUpdateCompatibleAsync<TEntity>(
        this IQueryable<TEntity> query,
        DbContext context,
        Expression<Func<SetPropertyCalls<TEntity>, SetPropertyCalls<TEntity>>> setPropertyCalls,
        Action<TEntity> memoryFallback,
        CancellationToken cancellationToken = default) where TEntity : class
    {
        if (context.Database.IsRelational())
        {
            await query.ExecuteUpdateAsync(setPropertyCalls, cancellationToken);
            return;
        }

        var entities = await query.ToListAsync(cancellationToken);
        if (entities.Count > 0)
        {
            foreach (var entity in entities)
            {
                memoryFallback(entity);
            }
            await context.SaveChangesAsync(cancellationToken);
        }
    }
}
