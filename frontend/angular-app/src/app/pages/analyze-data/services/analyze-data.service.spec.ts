import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DatasetAnalysisResponse,
  DatasetResponse,
  ProjectResponse,
  ProjectWorkflow,
} from '../../../services/api.models';
import { ForgeApiService } from '../../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../../services/project-workflow-context.service';
import { AnalyzeDataService } from './analyze-data.service';

const project: ProjectResponse = {
  id: 10,
  name: 'Sales analysis',
  description: 'Analysis regression fixture',
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

function workflow(
  sourceDatasets = datasets,
  currentDatasetIds: number[] = [],
  versionNumber = 1,
): ProjectWorkflow {
  return {
    projectId: 10,
    projectName: project.name,
    workflowState: currentDatasetIds.length === sourceDatasets.length ? 'NeedsCleaning' : 'NeedsAnalysis',
    currentStep: currentDatasetIds.length === sourceDatasets.length ? 'Clean' : 'Analyze',
    nextStep: currentDatasetIds.length === sourceDatasets.length ? 'Schema' : 'Clean',
    recommendedRoute: currentDatasetIds.length === sourceDatasets.length
      ? '/projects/10/clean'
      : '/projects/10/analyze',
    canImport: true,
    canAnalyze: sourceDatasets.length > 0,
    canClean: currentDatasetIds.length === sourceDatasets.length,
    canBuildSchema: false,
    canExport: false,
    canDeploy: false,
    blockerCodes: currentDatasetIds.length === sourceDatasets.length ? [] : ['analysis_required'],
    blockingReasons: currentDatasetIds.length === sourceDatasets.length ? [] : ['Analysis is required.'],
    datasets: sourceDatasets.map((dataset) => {
      const current = currentDatasetIds.includes(dataset.id);
      return {
        datasetId: dataset.id,
        datasetName: dataset.tableName,
        activeVersionId: dataset.id * 10 + versionNumber,
        activeVersionNumber: versionNumber,
        rowCount: dataset.rowCount,
        columnCount: dataset.columnCount,
        hasCurrentAnalysis: current,
        requiresAnalysis: !current,
        isQualityConfirmed: false,
      };
    }),
    schemaStatus: 'None',
    latestDeploymentStatus: null,
  };
}

function analysis(dataset: DatasetResponse, versionNumber = 1): DatasetAnalysisResponse {
  return {
    datasetId: dataset.id,
    tableName: dataset.tableName,
    status: 'Analyzed',
    analysisResult: {
      rowCount: dataset.rowCount,
      columnCount: dataset.columnCount,
      missingValuesCount: 0,
      duplicateRowsCount: 0,
      duplicateRowRule: 'all_columns',
      columns: [],
      columnTypeDistribution: [],
    },
    chartRecommendations: [],
    analyzedAt: '2026-01-03T00:00:00Z',
    datasetVersionId: dataset.id * 10 + versionNumber,
    datasetVersionNumber: versionNumber,
    isCleanedVersion: versionNumber > 1,
    analysisEngine: 'python',
  };
}

interface SetupResult {
  service: AnalyzeDataService;
  api: {
    getProject: ReturnType<typeof vi.fn>;
    getProjectDatasets: ReturnType<typeof vi.fn>;
    getProjectWorkflow: ReturnType<typeof vi.fn>;
    getDatasetAnalysis: ReturnType<typeof vi.fn>;
    analyzeDataset: ReturnType<typeof vi.fn>;
  };
}

function setup(overrides: Partial<SetupResult['api']> = {}): SetupResult {
  const api = {
    getProject: vi.fn(() => of(project)),
    getProjectDatasets: vi.fn(() => of(datasets)),
    getProjectWorkflow: vi.fn(() => of(workflow())),
    getDatasetAnalysis: vi.fn((datasetId: number) => {
      const dataset = datasets.find((item) => item.id === datasetId)!;
      return of(analysis(dataset));
    }),
    analyzeDataset: vi.fn((datasetId: number) => {
      const dataset = datasets.find((item) => item.id === datasetId)!;
      return of(analysis(dataset));
    }),
    ...overrides,
  };

  TestBed.configureTestingModule({
    providers: [
      AnalyzeDataService,
      ProjectWorkflowContextService,
      { provide: ForgeApiService, useValue: api },
    ],
  });

  return {
    service: TestBed.inject(AnalyzeDataService),
    api,
  };
}

afterEach(() => TestBed.resetTestingModule());

describe('AnalyzeDataService', () => {
  it.each([
    {
      requestedDatasetId: 8,
      expectedScope: 8,
      expectedNotice: '',
    },
    {
      requestedDatasetId: 999,
      expectedScope: 'project',
      expectedNotice: 'The selected dataset is not in this project. Showing all datasets.',
    },
  ] as const)(
    'applies datasetId $requestedDatasetId only after the async workspace is available',
    ({ requestedDatasetId, expectedScope, expectedNotice }) => {
      const projectResult = new Subject<ProjectResponse>();
      const datasetResult = new Subject<DatasetResponse[]>();
      const workflowResult = new Subject<ProjectWorkflow>();
      const { service } = setup({
        getProject: vi.fn(() => projectResult.asObservable()),
        getProjectDatasets: vi.fn(() => datasetResult.asObservable()),
        getProjectWorkflow: vi.fn(() => workflowResult.asObservable()),
      });

      service.loadWorkspace(10, requestedDatasetId);

      expect(service.loading()).toBe(true);
      expect(service.scope()).toBe('project');

      projectResult.next(project);
      projectResult.complete();
      datasetResult.next(datasets);
      datasetResult.complete();
      workflowResult.next(workflow());
      workflowResult.complete();

      expect(service.loading()).toBe(false);
      expect(service.scope()).toBe(expectedScope);
      expect(service.scopeNotice()).toBe(expectedNotice);
    },
  );

  it('loads a saved analysis only when it matches the active dataset version', () => {
    const currentWorkflow = workflow([datasets[0]], [7], 2);
    const currentAnalysis = analysis(datasets[0], 2);
    const { service, api } = setup({
      getProjectDatasets: vi.fn(() => of([datasets[0]])),
      getProjectWorkflow: vi.fn(() => of(currentWorkflow)),
      getDatasetAnalysis: vi.fn(() => of(currentAnalysis)),
    });

    service.loadWorkspace(10, 7);

    expect(api.getDatasetAnalysis).toHaveBeenCalledOnce();
    expect(api.getDatasetAnalysis).toHaveBeenCalledWith(7);
    expect(service.analyses()).toEqual({ 7: currentAnalysis });
    expect(service.currentAnalyses()).toEqual({ 7: currentAnalysis });
    expect(service.scopeAnalyses()).toEqual([currentAnalysis]);
    expect(service.resultLoadFailures()).toEqual([]);
  });

  it('rejects a stale saved result and reports an active-version conflict', () => {
    const currentWorkflow = workflow([datasets[0]], [7], 2);
    const staleAnalysis = analysis(datasets[0], 1);
    const { service } = setup({
      getProjectDatasets: vi.fn(() => of([datasets[0]])),
      getProjectWorkflow: vi.fn(() => of(currentWorkflow)),
      getDatasetAnalysis: vi.fn(() => of(staleAnalysis)),
    });

    service.loadWorkspace(10, 7);

    expect(service.analyses()).toEqual({});
    expect(service.currentAnalyses()).toEqual({});
    expect(service.scopeHasSavedAnalysis()).toBe(false);
    expect(service.resultLoadFailures()).toEqual([
      expect.objectContaining({
        datasetId: 7,
        datasetName: 'customers',
        conflict: true,
        message: 'The active dataset version changed while analysis was running. Run analysis again.',
      }),
    ]);
  });

  it('blocks scope changes and new runs until saved analyses finish loading', () => {
    const savedAnalysis = new Subject<DatasetAnalysisResponse>();
    const currentWorkflow = workflow([datasets[0]], [7], 2);
    const { service, api } = setup({
      getProjectDatasets: vi.fn(() => of([datasets[0]])),
      getProjectWorkflow: vi.fn(() => of(currentWorkflow)),
      getDatasetAnalysis: vi.fn(() => savedAnalysis.asObservable()),
    });

    service.loadWorkspace(10, 7);

    expect(service.loading()).toBe(false);
    expect(service.resultsLoading()).toBe(true);
    expect(service.analysisActionLabel()).toBe('Loading saved analysis…');

    service.setScope('project');
    service.runAnalysis();

    expect(service.scope()).toBe(7);
    expect(api.analyzeDataset).not.toHaveBeenCalled();

    savedAnalysis.next(analysis(datasets[0], 2));
    savedAnalysis.complete();

    expect(service.resultsLoading()).toBe(false);
    expect(service.analyses()).toEqual({ 7: analysis(datasets[0], 2) });
  });

  it('analyzes only the selected dataset, but targets every dataset in project scope', () => {
    const beforeAnalysis = workflow(datasets);
    const afterAnalysis = workflow(datasets, [7, 8]);
    const getProjectWorkflow = vi.fn()
      .mockReturnValueOnce(of(beforeAnalysis))
      .mockReturnValue(of(afterAnalysis));
    const { service, api } = setup({ getProjectWorkflow });

    service.loadWorkspace(10, null);
    service.setScope(8);
    service.runAnalysis();

    expect(api.analyzeDataset).toHaveBeenCalledTimes(1);
    expect(api.analyzeDataset).toHaveBeenCalledWith(8, { analysisType: 'profile' });
    expect(service.feedback()).toEqual({
      kind: 'success',
      message: 'Analysis completed for 1 dataset.',
    });

    api.analyzeDataset.mockClear();
    service.setScope('project');
    service.runAnalysis();

    expect(api.analyzeDataset.mock.calls.map(([datasetId]) => datasetId)).toEqual([7, 8]);
    expect(service.progressTotal()).toBe(2);
    expect(service.feedback()).toEqual({
      kind: 'success',
      message: 'Analysis completed for 2 datasets.',
    });
  });
});
