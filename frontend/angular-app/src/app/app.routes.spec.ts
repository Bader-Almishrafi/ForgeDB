import { ActivatedRouteSnapshot, RedirectFunction, Route, Routes } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';

function flatten(items: Routes, parent = ''): Array<{ fullPath: string; route: Route }> {
  return items.flatMap((route) => {
    const fullPath = [parent, route.path].filter(Boolean).join('/');
    return [{ fullPath, route }, ...flatten(route.children ?? [], fullPath)];
  });
}

describe('simplified application routes', () => {
  const allRoutes = flatten(routes);

  it('defines Projects plus the five canonical project workflow routes', () => {
    const paths = allRoutes.map((item) => item.fullPath);
    expect(paths).toContain('projects');
    expect(paths).toContain('projects/new');
    expect(paths).toEqual(expect.arrayContaining([
      'projects/:projectId/data',
      'projects/:projectId/analyze',
      'projects/:projectId/clean',
      'projects/:projectId/schema',
      'projects/:projectId/export-deploy',
    ]));

    const projectRoute = allRoutes.find((item) => item.fullPath === 'projects/:projectId')?.route;
    const canonicalSteps = projectRoute?.children?.filter((route) => route.loadComponent) ?? [];
    expect(canonicalSteps.map((route) => route.path)).toEqual(['data', 'analyze', 'clean', 'schema', 'export-deploy']);
  });

  it('has no ER Diagram route', () => {
    expect(allRoutes.some((item) => item.fullPath.toLocaleLowerCase().includes('er-diagram'))).toBe(false);
  });

  it('retains safe project legacy redirects without localStorage context', () => {
    const projectRoute = allRoutes.find((item) => item.fullPath === 'projects/:projectId')?.route;
    const redirects = Object.fromEntries((projectRoute?.children ?? [])
      .filter((route) => typeof route.redirectTo === 'string' && route.path)
      .map((route) => [route.path!, route.redirectTo]));

    expect(redirects).toMatchObject({
      overview: 'data',
      datasets: 'data',
      upload: 'data',
      analysis: 'analyze',
      'data-cleaning': 'clean',
      'schema-designer': 'schema',
      relationships: 'schema',
      exports: 'export-deploy',
      deployment: 'export-deploy',
    });
    expect(allRoutes.find((item) => item.fullPath === 'home')?.route.redirectTo).toBe('projects');
  });

  it('redirects standalone Explorer, Dashboard, and Profile URLs to canonical Analyze', () => {
    for (const path of ['datasets/:datasetId/explorer', 'datasets/:datasetId/dashboard', 'datasets/:datasetId/profile']) {
      const redirect = allRoutes.find((item) => item.fullPath === path)?.route.redirectTo as RedirectFunction;
      expect(redirect({ params: { datasetId: '7' }, queryParams: { returnProject: '10' } } as unknown as ActivatedRouteSnapshot))
        .toBe('/projects/10/analyze?datasetId=7');
    }
  });

  it('does not lazy-load duplicate Analysis or Dashboard page components', () => {
    const loaders = allRoutes.map((item) => item.route.loadComponent?.toString() ?? '').join('\n');
    expect(loaders).not.toContain("pages/analysis");
    expect(loaders).not.toContain("pages/dashboard");
    expect(loaders).not.toContain("pages/project-relationships");
    expect(loaders).not.toContain("pages/project-exports");
    expect(loaders).not.toContain("pages/project-deployment");
  });

  it('lazy-loads page and shell components', () => {
    const componentRoutes = allRoutes.filter((item) => item.route.redirectTo === undefined && item.route.path !== '**');
    expect(componentRoutes.length).toBeGreaterThan(0);
    for (const item of componentRoutes) {
      expect(item.route.component, item.fullPath).toBeUndefined();
      expect(item.route.loadComponent, item.fullPath).toBeTypeOf('function');
    }
  });
});
