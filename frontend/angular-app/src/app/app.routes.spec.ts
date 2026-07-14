import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';

describe('application route loading', () => {
  it('lazy-loads every page component so feature workspaces stay out of the initial bundle', () => {
    const pageRoutes = routes.flatMap((route) => route.children ?? [route])
      .filter((route) => route.path !== '**' && route.redirectTo === undefined);

    expect(pageRoutes.length).toBeGreaterThan(0);
    for (const route of pageRoutes) {
      expect(route.component, route.path).toBeUndefined();
      expect(route.loadComponent, route.path).toBeTypeOf('function');
    }
  });
});
