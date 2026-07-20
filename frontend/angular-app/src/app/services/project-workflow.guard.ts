import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { ProjectWorkflow } from './api.models';
import { ProjectWorkflowContextService } from './project-workflow-context.service';
import { snapshotParameter } from './route-context';

export type ProjectWorkflowStep = 'data' | 'analyze' | 'clean' | 'schema' | 'export-deploy';

export interface ProjectWorkflowStepDefinition {
  path: ProjectWorkflowStep;
  label: string;
  permission: keyof Pick<ProjectWorkflow, 'canImport' | 'canAnalyze' | 'canClean' | 'canBuildSchema' | 'canExport'>;
}

export const PROJECT_WORKFLOW_STEPS: readonly ProjectWorkflowStepDefinition[] = [
  { path: 'data', label: 'Data', permission: 'canImport' },
  { path: 'analyze', label: 'Analyze', permission: 'canAnalyze' },
  { path: 'clean', label: 'Clean', permission: 'canClean' },
  { path: 'schema', label: 'Schema', permission: 'canBuildSchema' },
  { path: 'export-deploy', label: 'Export & Deploy', permission: 'canExport' },
];

export function isWorkflowStepAllowed(workflow: ProjectWorkflow, path: string): boolean {
  const step = PROJECT_WORKFLOW_STEPS.find((item) => item.path === path);
  return step ? workflow[step.permission] : false;
}

export const projectWorkflowGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const context = inject(ProjectWorkflowContextService);
  const projectId = snapshotParameter(route, 'projectId');
  if (projectId === null) {
    context.load(0);
    return true;
  }

  const requestedStep = route.routeConfig?.path ?? '';
  // Revalidate on every step transition so analysis/cleaning/schema mutations cannot leave a
  // cached permission decision in control of navigation.
  return context.load(projectId, true).pipe(map((workflow) => {
    // The shell owns clear API error states. Allow activation so it can show 403/404/retry copy.
    if (!workflow) return true;
    if (isWorkflowStepAllowed(workflow, requestedStep)) return true;

    const requestedPath = state.url.split('?')[0].replace(/\/$/, '');
    const recommendedPath = canonicalRecommendedRoute(workflow, projectId);
    if (requestedPath === recommendedPath) return true;

    return router.createUrlTree(recommendedPath.split('/').filter(Boolean), {
      queryParams: route.queryParamMap.get('datasetId') ? { datasetId: route.queryParamMap.get('datasetId') } : undefined,
    });
  }));
};

function canonicalRecommendedRoute(workflow: ProjectWorkflow, projectId: number): string {
  const allowedPrefix = `/projects/${projectId}/`;
  const route = workflow.recommendedRoute.split('?')[0].replace(/\/$/, '');
  const step = route.slice(allowedPrefix.length);
  return route.startsWith(allowedPrefix) && PROJECT_WORKFLOW_STEPS.some((item) => item.path === step)
    ? route
    : `${allowedPrefix}data`;
}
