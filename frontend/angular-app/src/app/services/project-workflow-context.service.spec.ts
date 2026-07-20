import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectWorkflow } from './api.models';
import { ForgeApiService } from './forge-api.service';
import { ProjectWorkflowContextService } from './project-workflow-context.service';
import { queryParameter, routeParameter } from './route-context';

function workflow(projectId: number, projectName = `Project ${projectId}`): ProjectWorkflow {
  return {
    projectId,
    projectName,
    workflowState: 'NeedsAnalysis',
    currentStep: 'Analyze',
    nextStep: 'Clean',
    recommendedRoute: `/projects/${projectId}/analyze`,
    canImport: true,
    canAnalyze: true,
    canClean: false,
    canBuildSchema: false,
    canExport: false,
    canDeploy: false,
    blockerCodes: ['analysis_required'],
    blockingReasons: ['Analyze every active dataset version.'],
    datasets: [],
    schemaStatus: 'None',
    latestDeploymentStatus: null,
  };
}

describe('ProjectWorkflowContextService', () => {
  afterEach(() => localStorage.clear());

  it('ignores legacy workflow localStorage and reconstructs state from the backend response', () => {
    localStorage.setItem('forgedb.currentProjectId', '999');
    localStorage.setItem('forgedb.currentProjectName', 'Stored project');
    localStorage.setItem('forgedb.currentDatasetId', '888');
    const getProjectWorkflow = vi.fn(() => of(workflow(10, 'Route project')));
    const service = new ProjectWorkflowContextService({ getProjectWorkflow } as unknown as ForgeApiService);

    expect(service.projectId()).toBeNull();
    expect(service.datasetId()).toBeNull();
    service.load(10).subscribe();
    service.setDatasetFromQuery(42);

    expect(getProjectWorkflow).toHaveBeenCalledWith(10);
    expect(service.workflow()?.projectName).toBe('Route project');
    expect(service.datasetId()).toBe(42);
  });

  it('clears the previous project name and dataset as soon as the route changes projects', () => {
    const second = new Subject<ProjectWorkflow>();
    const getProjectWorkflow = vi.fn((projectId: number) => projectId === 1 ? of(workflow(1, 'First')) : second);
    const service = new ProjectWorkflowContextService({ getProjectWorkflow } as unknown as ForgeApiService);
    service.load(1).subscribe();
    service.setDatasetFromQuery(7);

    service.load(2).subscribe();

    expect(service.projectId()).toBe(2);
    expect(service.workflow()).toBeNull();
    expect(service.datasetId()).toBeNull();
    second.next(workflow(2, 'Second'));
    second.complete();
    expect(service.workflow()?.projectName).toBe('Second');
  });

  it('keeps the query-selected dataset when the same project workflow is revalidated', () => {
    const getProjectWorkflow = vi.fn(() => of(workflow(1)));
    const service = new ProjectWorkflowContextService({ getProjectWorkflow } as unknown as ForgeApiService);
    service.load(1).subscribe();
    service.setDatasetFromQuery(7);

    service.load(1, true).subscribe();

    expect(service.datasetId()).toBe(7);
    expect(getProjectWorkflow).toHaveBeenCalledTimes(2);
  });

  it('keeps the current workflow visible without entering initial loading during a same-project refresh', () => {
    const refreshed = new Subject<ProjectWorkflow>();
    const getProjectWorkflow = vi.fn()
      .mockReturnValueOnce(of(workflow(1, 'Before refresh')))
      .mockReturnValueOnce(refreshed);
    const service = new ProjectWorkflowContextService({ getProjectWorkflow } as unknown as ForgeApiService);
    service.load(1).subscribe();

    service.load(1, true).subscribe();
    expect(service.loading()).toBe(false);
    expect(service.workflow()?.projectName).toBe('Before refresh');

    refreshed.next(workflow(1, 'After refresh'));
    refreshed.complete();
    expect(service.loading()).toBe(false);
    expect(service.workflow()?.projectName).toBe('After refresh');
  });

  it('reads project context from an ancestor route and dataset selection from the query string', () => {
    const route = {
      snapshot: {
        paramMap: convertToParamMap({}),
        queryParamMap: convertToParamMap({ datasetId: '44' }),
      },
      parent: {
        snapshot: { paramMap: convertToParamMap({ projectId: '12' }) },
        parent: null,
      },
    } as unknown as ActivatedRoute;

    expect(routeParameter(route, 'projectId')).toBe(12);
    expect(queryParameter(route, 'datasetId')).toBe(44);
  });
});
