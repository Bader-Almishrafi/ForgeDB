import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DatasetResponse,
  ProjectResponse,
  ProjectWorkflow,
} from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { AnalyzeDataComponent } from './analyze-data.component';

const project: ProjectResponse = {
  id: 10,
  name: 'Sales analysis',
  description: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: null,
  workflowState: 'NeedsAnalysis',
  currentStep: 'Analyze',
  recommendedRoute: '/projects/10/analyze',
  datasetsCount: 2,
};

const datasets: DatasetResponse[] = [
  {
    id: 7,
    projectId: 10,
    tableName: 'customers',
    sourceType: 'csv',
    sourceName: 'customers.csv',
    rowCount: 2,
    columnCount: 2,
    missingValuesCount: 0,
    duplicateRowsCount: 0,
    status: 'Imported',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 8,
    projectId: 10,
    tableName: 'orders',
    sourceType: 'csv',
    sourceName: 'orders.csv',
    rowCount: 3,
    columnCount: 3,
    missingValuesCount: 0,
    duplicateRowsCount: 0,
    status: 'Imported',
    createdAt: '2026-01-02T00:00:00Z',
  },
];

const projectWorkflow: ProjectWorkflow = {
  projectId: 10,
  projectName: project.name,
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
  datasets: datasets.map((dataset) => ({
    datasetId: dataset.id,
    datasetName: dataset.tableName,
    activeVersionId: dataset.id * 10 + 1,
    activeVersionNumber: 1,
    rowCount: dataset.rowCount,
    columnCount: dataset.columnCount,
    hasCurrentAnalysis: false,
    requiresAnalysis: true,
    isQualityConfirmed: false,
  })),
  schemaStatus: 'None',
  latestDeploymentStatus: null,
};

interface SetupOptions {
  queryDatasetId?: string;
  asyncWorkspace?: boolean;
}

interface SetupResult {
  fixture: ComponentFixture<AnalyzeDataComponent>;
  router: Router;
  query: BehaviorSubject<ParamMap>;
  completeWorkspace: () => void;
}

async function setup(options: SetupOptions = {}): Promise<SetupResult> {
  const query = new BehaviorSubject<ParamMap>(convertToParamMap(
    options.queryDatasetId === undefined ? {} : { datasetId: options.queryDatasetId },
  ));
  const projectResult = new Subject<ProjectResponse>();
  const datasetResult = new Subject<DatasetResponse[]>();
  const workflowResult = new Subject<ProjectWorkflow>();
  const api = {
    getProject: vi.fn(() => options.asyncWorkspace ? projectResult.asObservable() : of(project)),
    getProjectDatasets: vi.fn(() => options.asyncWorkspace ? datasetResult.asObservable() : of(datasets)),
    getProjectWorkflow: vi.fn(() => options.asyncWorkspace ? workflowResult.asObservable() : of(projectWorkflow)),
    getDatasetAnalysis: vi.fn(),
    analyzeDataset: vi.fn(),
  };
  const route = {
    snapshot: {
      paramMap: convertToParamMap({ projectId: '10' }),
      queryParamMap: query.value,
    },
    queryParamMap: query.asObservable(),
  };

  await TestBed.configureTestingModule({
    imports: [AnalyzeDataComponent],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: route },
      { provide: ForgeApiService, useValue: api },
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(AnalyzeDataComponent);
  fixture.detectChanges();

  return {
    fixture,
    router,
    query,
    completeWorkspace: () => {
      if (!options.asyncWorkspace) return;
      projectResult.next(project);
      projectResult.complete();
      datasetResult.next(datasets);
      datasetResult.complete();
      workflowResult.next(projectWorkflow);
      workflowResult.complete();
      fixture.detectChanges();
    },
  };
}

afterEach(() => TestBed.resetTestingModule());

describe('AnalyzeDataComponent', () => {
  it.each([
    {
      datasetId: '8',
      expectedScope: 8,
      expectedNotice: '',
    },
    {
      datasetId: '999',
      expectedScope: 'project',
      expectedNotice: 'The selected dataset is not in this project. Showing all datasets.',
    },
  ] as const)(
    'applies initial datasetId $datasetId after an asynchronous workspace load',
    async ({ datasetId, expectedScope, expectedNotice }) => {
      const { fixture, completeWorkspace } = await setup({
        queryDatasetId: datasetId,
        asyncWorkspace: true,
      });

      expect(fixture.componentInstance.service.scope()).toBe('project');

      completeWorkspace();

      expect(fixture.componentInstance.service.scope()).toBe(expectedScope);
      expect(fixture.componentInstance.service.scopeNotice()).toBe(expectedNotice);
    },
  );

  it('keeps project and dataset scopes distinct and updates datasetId in the URL', async () => {
    const { fixture, router } = await setup();
    const component = fixture.componentInstance;

    component.changeScope(8);

    expect(component.service.scope()).toBe(8);
    expect(component.service.selectedDataset()?.id).toBe(8);
    expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
      queryParams: { datasetId: 8 },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    }));

    component.changeScope('project');

    expect(component.service.scope()).toBe('project');
    expect(component.service.selectedDataset()).toBeNull();
    expect(component.service.scopeDatasets().map((dataset) => dataset.id)).toEqual([7, 8]);
    expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
      queryParams: { datasetId: null },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    }));
  });

  it('reacts to later query changes without reloading the workspace', async () => {
    const { fixture, query } = await setup();
    const loadWorkspace = vi.spyOn(fixture.componentInstance.service, 'loadWorkspace');

    query.next(convertToParamMap({ datasetId: '7' }));
    fixture.detectChanges();

    expect(fixture.componentInstance.service.scope()).toBe(7);
    expect(loadWorkspace).not.toHaveBeenCalled();

    query.next(convertToParamMap({ datasetId: 'not-a-number' }));
    fixture.detectChanges();

    expect(fixture.componentInstance.service.scope()).toBe('project');
    expect(fixture.componentInstance.service.scopeNotice()).toContain('not in this project');
    expect(loadWorkspace).not.toHaveBeenCalled();
  });
});
