import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectWorkflow } from './api.models';
import { ProjectWorkflowContextService } from './project-workflow-context.service';
import { PROJECT_WORKFLOW_STEPS, projectWorkflowGuard } from './project-workflow.guard';

const workflow: ProjectWorkflow = {
  projectId: 10,
  projectName: 'Guarded project',
  workflowState: 'NeedsAnalysis',
  currentStep: 'Analyze',
  nextStep: 'Clean',
  recommendedRoute: '/projects/10/analyze',
  canImport: true,
  canAnalyze: true,
  canClean: false,
  canBuildSchema: false,
  canExport: false,
  canDeploy: false,
  blockerCodes: ['analysis_required'],
  blockingReasons: ['Analysis is required.'],
  datasets: [],
  schemaStatus: 'None',
};

function childRoute(step: string, datasetId?: string): ActivatedRouteSnapshot {
  return {
    routeConfig: { path: step },
    paramMap: convertToParamMap({}),
    queryParamMap: convertToParamMap(datasetId ? { datasetId } : {}),
    parent: {
      paramMap: convertToParamMap({ projectId: '10' }),
      parent: null,
    },
  } as unknown as ActivatedRouteSnapshot;
}

describe('projectWorkflowGuard', () => {
  const redirectTree = new UrlTree();
  const createUrlTree = vi.fn(() => redirectTree);
  const load = vi.fn(() => of(workflow));

  beforeEach(() => {
    createUrlTree.mockClear();
    load.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { createUrlTree } },
        { provide: ProjectWorkflowContextService, useValue: { load } },
      ],
    });
  });

  it('defines exactly the five visible workflow steps', () => {
    expect(PROJECT_WORKFLOW_STEPS.map((step) => step.label)).toEqual([
      'Data', 'Analyze', 'Clean', 'Schema', 'Export & Deploy',
    ]);
  });

  it('allows steps permitted by the backend workflow response', async () => {
    const result = TestBed.runInInjectionContext(() => projectWorkflowGuard(
      childRoute('analyze'),
      { url: '/projects/10/analyze' } as RouterStateSnapshot,
    ));

    await expect(firstValueFrom(result as Observable<boolean | UrlTree>)).resolves.toBe(true);
    expect(load).toHaveBeenCalledWith(10, true);
    expect(createUrlTree).not.toHaveBeenCalled();
  });

  it('redirects a directly opened blocked route to recommendedRoute and preserves datasetId', async () => {
    const result = TestBed.runInInjectionContext(() => projectWorkflowGuard(
      childRoute('schema', '42'),
      { url: '/projects/10/schema?datasetId=42' } as RouterStateSnapshot,
    ));

    await expect(firstValueFrom(result as Observable<boolean | UrlTree>)).resolves.toBe(redirectTree);
    expect(createUrlTree).toHaveBeenCalledWith(['projects', '10', 'analyze'], { queryParams: { datasetId: '42' } });
  });

  it('avoids a redirect loop when the requested URL is already the backend recommendation', async () => {
    load.mockReturnValueOnce(of({ ...workflow, canAnalyze: false }));
    const result = TestBed.runInInjectionContext(() => projectWorkflowGuard(
      childRoute('analyze'),
      { url: '/projects/10/analyze' } as RouterStateSnapshot,
    ));

    await expect(firstValueFrom(result as Observable<boolean | UrlTree>)).resolves.toBe(true);
    expect(createUrlTree).not.toHaveBeenCalled();
  });
});
