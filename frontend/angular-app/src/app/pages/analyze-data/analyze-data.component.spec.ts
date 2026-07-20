import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetAnalysisResponse, DatasetResponse, ProjectResponse, ProjectWorkflow } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { AnalyzeDataComponent } from './analyze-data.component';

const project: ProjectResponse = {
  id: 10, name: 'Quality review', description: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: null,
  workflowState: 'NeedsAnalysis', currentStep: 'Analyze', recommendedRoute: '/projects/10/analyze', datasetsCount: 2,
};
const customers: DatasetResponse = {
  id: 1, projectId: 10, tableName: 'customers', sourceType: 'csv', sourceName: 'customers.csv', rowCount: 10, columnCount: 2,
  missingValuesCount: 99, duplicateRowsCount: 99, status: 'Analyzed', createdAt: '2026-01-01T00:00:00Z',
};
const orders: DatasetResponse = {
  id: 2, projectId: 10, tableName: 'orders', sourceType: 'api', sourceName: 'https://api.example.com/orders', rowCount: 8, columnCount: 2,
  missingValuesCount: 0, duplicateRowsCount: 0, status: 'Imported', createdAt: '2026-01-02T00:00:00Z',
};

function analysis(dataset: DatasetResponse, version = 1): DatasetAnalysisResponse {
  return {
    datasetId: dataset.id,
    tableName: dataset.tableName,
    status: 'Analyzed',
    analyzedAt: '2026-07-20T08:00:00Z',
    datasetVersionId: dataset.id * 100 + version,
    datasetVersionNumber: version,
    isCleanedVersion: version > 1,
    analysisEngine: 'python-profile',
    analysisResult: {
      rowCount: dataset.rowCount,
      columnCount: dataset.columnCount,
      missingValuesCount: dataset.id === 1 ? 2 : 0,
      duplicateRowsCount: dataset.id === 1 ? 1 : 0,
      duplicateRowRule: 'All values match',
      columns: [
        {
          columnName: 'id', detectedDataType: 'integer', missingValuesCount: 0, uniqueValuesCount: dataset.rowCount,
          isNullable: false, sampleValues: ['1', '2'], numericStats: { columnName: 'id', min: 1, max: dataset.rowCount, average: 5, count: dataset.rowCount }, mostCommonValues: [],
        },
        {
          columnName: 'email', detectedDataType: 'string', missingValuesCount: dataset.id === 1 ? 2 : 0, uniqueValuesCount: 6,
          isNullable: true, sampleValues: ['a@example.com'], numericStats: null, mostCommonValues: [],
        },
      ],
      columnTypeDistribution: [{ dataType: 'integer', count: 1 }, { dataType: 'string', count: 1 }],
    },
    chartRecommendations: [{ chartType: 'bar', title: 'Review missing email values', columns: ['email'], reason: 'Email has missing values.' }],
  };
}

function workflow(
  datasets: DatasetResponse[],
  states: Record<number, { analyzed: boolean; version?: number }> = {},
  canClean = false,
): ProjectWorkflow {
  return {
    projectId: 10,
    projectName: 'Quality review',
    workflowState: Object.values(states).some((state) => !state.analyzed && (state.version ?? 1) > 1) ? 'NeedsReanalysis' : 'NeedsAnalysis',
    currentStep: 'Analyze',
    nextStep: 'Clean',
    recommendedRoute: '/projects/10/analyze',
    canImport: true,
    canAnalyze: datasets.length > 0,
    canClean,
    canBuildSchema: false,
    canExport: false,
    canDeploy: false,
    blockerCodes: canClean ? [] : ['analysis_required'],
    blockingReasons: canClean ? [] : ['Analyze every active dataset version.'],
    datasets: datasets.map((dataset) => {
      const state = states[dataset.id] ?? { analyzed: false, version: 1 };
      const version = state.version ?? 1;
      return {
        datasetId: dataset.id,
        datasetName: dataset.tableName,
        activeVersionId: dataset.id * 100 + version,
        activeVersionNumber: version,
        rowCount: dataset.rowCount,
        columnCount: dataset.columnCount,
        hasCurrentAnalysis: state.analyzed,
        requiresAnalysis: !state.analyzed,
        isQualityConfirmed: false,
      };
    }),
    schemaStatus: 'None',
    latestDeploymentStatus: null,
  };
}

interface SetupOptions {
  datasets?: DatasetResponse[];
  queryDatasetId?: string | null;
  workflow?: ProjectWorkflow;
  saved?: Record<number, DatasetAnalysisResponse>;
  failureIds?: number[];
  conflictIds?: number[];
  enableCleanAfterSuccess?: boolean;
}

interface SetupResult {
  fixture: ComponentFixture<AnalyzeDataComponent>;
  component: AnalyzeDataComponent;
  api: Record<string, ReturnType<typeof vi.fn>>;
  router: Router;
  context: ProjectWorkflowContextService;
  setWorkflow: (value: ProjectWorkflow) => void;
}

async function setup(options: SetupOptions = {}): Promise<SetupResult> {
  const datasets = options.datasets ?? [customers, orders];
  const saved = { ...(options.saved ?? {}) };
  let currentWorkflow = options.workflow ?? workflow(datasets);
  const query = new BehaviorSubject<ParamMap>(convertToParamMap(options.queryDatasetId ? { datasetId: options.queryDatasetId } : {}));
  const route = {
    snapshot: { paramMap: convertToParamMap({ projectId: '10' }), queryParamMap: query.value },
    queryParamMap: query.asObservable(),
  };
  const api: Record<string, ReturnType<typeof vi.fn>> = {
    getProject: vi.fn(() => of({ ...project, datasetsCount: datasets.length })),
    getProjectDatasets: vi.fn(() => of(datasets)),
    getProjectWorkflow: vi.fn(() => of(currentWorkflow)),
    getDatasetAnalysis: vi.fn((datasetId: number) => saved[datasetId]
      ? of(saved[datasetId])
      : throwError(() => ({ status: 404, error: { message: 'No saved analysis.' } }))),
    analyzeDataset: vi.fn((datasetId: number) => {
      const dataset = datasets.find((item) => item.id === datasetId)!;
      if (options.conflictIds?.includes(datasetId)) {
        const old = currentWorkflow.datasets.find((item) => item.datasetId === datasetId)!;
        currentWorkflow = workflow(datasets, Object.fromEntries(currentWorkflow.datasets.map((item) => [item.datasetId, {
          analyzed: item.datasetId === datasetId ? false : item.hasCurrentAnalysis,
          version: item.datasetId === datasetId ? (old.activeVersionNumber ?? 1) + 1 : item.activeVersionNumber ?? 1,
        }])));
        return throwError(() => ({ status: 409, error: { message: 'Active dataset version changed.' } }));
      }
      if (options.failureIds?.includes(datasetId)) return throwError(() => ({ status: 500, error: { message: `${dataset.tableName} failed.` } }));

      const metadata = currentWorkflow.datasets.find((item) => item.datasetId === datasetId)!;
      const response = analysis(dataset, metadata.activeVersionNumber ?? 1);
      saved[datasetId] = response;
      const states = Object.fromEntries(currentWorkflow.datasets.map((item) => [item.datasetId, {
        analyzed: item.datasetId === datasetId ? true : item.hasCurrentAnalysis,
        version: item.activeVersionNumber ?? 1,
      }]));
      const allAnalyzed = Object.values(states).every((state) => state.analyzed);
      currentWorkflow = workflow(datasets, states, options.enableCleanAfterSuccess === true && allAnalyzed);
      return of(response);
    }),
  };

  await TestBed.configureTestingModule({
    imports: [AnalyzeDataComponent],
    providers: [
      provideRouter([]),
      { provide: ForgeApiService, useValue: api },
      { provide: ActivatedRoute, useValue: route },
    ],
  }).compileComponents();
  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(AnalyzeDataComponent);
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance,
    api,
    router,
    context: TestBed.inject(ProjectWorkflowContextService),
    setWorkflow: (value) => { currentWorkflow = value; },
  };
}

afterEach(() => TestBed.resetTestingModule());

describe('AnalyzeDataComponent', () => {
  it('uses project scope when datasetId is absent', async () => {
    const { component } = await setup();
    expect(component.scope()).toBe('project');
    expect(component.scopeDatasets()).toHaveLength(2);
  });

  it('uses dataset scope when datasetId belongs to the project', async () => {
    const { component } = await setup({ queryDatasetId: '2' });
    expect(component.scope()).toBe(2);
    expect(component.selectedDataset()?.tableName).toBe('orders');
  });

  it('removes an invalid datasetId and falls back to project scope with one notice', async () => {
    const { fixture, component, router } = await setup({ queryDatasetId: '999' });
    expect(component.scope()).toBe('project');
    expect(component.scopeNotice()).toContain('not in this project');
    expect(fixture.nativeElement.textContent.match(/not in this project/g)).toHaveLength(1);
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { datasetId: null }, replaceUrl: true }));
  });

  it('shows an empty project state with only a Go to Data action', async () => {
    const { fixture } = await setup({ datasets: [], workflow: workflow([]) });
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-empty-state"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Go to Data');
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-scope-selector"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="run-analysis"]')).toBeNull();
  });

  it('loads only saved analysis for the active dataset version', async () => {
    const saved = analysis(customers, 1);
    const { fixture, component, api } = await setup({
      queryDatasetId: '1',
      workflow: workflow([customers, orders], { 1: { analyzed: true, version: 1 }, 2: { analyzed: false, version: 1 } }),
      saved: { 1: saved },
    });
    expect(api['getDatasetAnalysis']).toHaveBeenCalledWith(1);
    expect(api['getDatasetAnalysis']).not.toHaveBeenCalledWith(2);
    expect(component.selectedAnalysis()?.datasetVersionNumber).toBe(1);
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-summary"]').textContent).toContain('python-profile');
  });

  it('shows Analysis required without trusting Dataset.status display text', async () => {
    const { fixture, api } = await setup({
      queryDatasetId: '1',
      datasets: [customers],
      workflow: workflow([customers], { 1: { analyzed: false, version: 1 } }),
    });
    expect(customers.status).toBe('Analyzed');
    expect(api['getDatasetAnalysis']).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-required-state"]').textContent).toContain('Analysis required');
  });

  it('shows Re-analysis required for a newer active version without current analysis', async () => {
    const { fixture } = await setup({
      queryDatasetId: '1',
      datasets: [customers],
      workflow: workflow([customers], { 1: { analyzed: false, version: 2 } }),
    });
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-required-state"]').textContent).toContain('Re-analysis required');
  });

  it('analyzes only the selected dataset, reloads the saved result, and refreshes workflow', async () => {
    const { component, api } = await setup({
      queryDatasetId: '2',
      workflow: workflow([customers, orders]),
    });
    component.runAnalysis();

    expect(api['analyzeDataset']).toHaveBeenCalledTimes(1);
    expect(api['analyzeDataset']).toHaveBeenCalledWith(2, { analysisType: 'profile' });
    expect(api['getDatasetAnalysis']).toHaveBeenCalledWith(2);
    expect(api['getProjectWorkflow']).toHaveBeenCalledTimes(2);
    expect(component.selectedAnalysis()?.datasetId).toBe(2);
  });

  it('analyzes a project sequentially, reports progress, and keeps successful results when one dataset fails', async () => {
    const { fixture, component, api } = await setup({ failureIds: [2] });
    component.runAnalysis();
    fixture.detectChanges();

    expect(api['analyzeDataset'].mock.calls.map((call) => call[0])).toEqual([1, 2]);
    expect(component.progressCurrent()).toBe(2);
    expect(component.progressTotal()).toBe(2);
    expect(component.currentAnalyses()[1]).toBeTruthy();
    expect(component.currentAnalyses()[2]).toBeUndefined();
    expect(component.executionFailures()[0].datasetName).toBe('orders');
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-summary"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-failures"]').textContent).toContain('orders failed');
  });

  it('prevents duplicate analysis clicks while a request is running', async () => {
    const { component, api } = await setup({ datasets: [customers], workflow: workflow([customers]) });
    const pending = new Subject<DatasetAnalysisResponse>();
    api['analyzeDataset'].mockReturnValue(pending);
    component.runAnalysis();
    component.runAnalysis();

    expect(api['analyzeDataset']).toHaveBeenCalledTimes(1);
    pending.error({ status: 500 });
  });

  it('handles active-version 409 without displaying stale analysis', async () => {
    const stale = analysis(customers, 1);
    const { fixture, component, api } = await setup({
      datasets: [customers],
      queryDatasetId: '1',
      workflow: workflow([customers], { 1: { analyzed: true, version: 1 } }),
      saved: { 1: stale },
      conflictIds: [1],
    });
    expect(component.selectedAnalysis()).toBeTruthy();
    component.runAnalysis();
    fixture.detectChanges();

    expect(component.selectedAnalysis()).toBeNull();
    expect(component.executionFailures()[0].conflict).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('active dataset version changed');
    expect(api['getProjectWorkflow']).toHaveBeenCalledTimes(2);
  });

  it('controls Continue to Clean from workflow and preserves datasetId', async () => {
    const { fixture, component, router, context, setWorkflow } = await setup({ queryDatasetId: '2' });
    let button = fixture.nativeElement.querySelector('[data-testid="continue-to-clean"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('Analyze every active dataset version');

    setWorkflow(workflow([customers, orders], { 1: { analyzed: true }, 2: { analyzed: true } }, true));
    context.load(10, true).subscribe();
    fixture.detectChanges();
    button = fixture.nativeElement.querySelector('[data-testid="continue-to-clean"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    expect(router.navigate).toHaveBeenCalledWith(['/projects', 10, 'clean'], { queryParams: { datasetId: 2 } });
    expect(component.canContinueToClean()).toBe(true);
  });

  it('renders useful summary, issues, columns, recommendations, and no more than three charts', async () => {
    const saved = analysis(customers, 1);
    const { fixture } = await setup({
      datasets: [customers],
      workflow: workflow([customers], { 1: { analyzed: true, version: 1 } }, true),
      saved: { 1: saved },
    });
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-summary"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-issues"]').textContent).toContain('Missing values');
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-columns"]').textContent).toContain('email');
    expect(fixture.nativeElement.querySelector('[data-testid="analysis-recommendations"]').textContent).toContain('Review missing email values');
    const charts = fixture.nativeElement.querySelectorAll('[data-analysis-chart]');
    expect(charts.length).toBeGreaterThan(0);
    expect(charts.length).toBeLessThanOrEqual(3);
    expect(fixture.nativeElement.querySelector('[role="tablist"]')).toBeNull();
  });
});
