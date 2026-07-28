import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CleaningApplyResponse,
  CleaningHistoryEntry,
  CleaningPreviewResponse,
  CleaningSuggestion,
  DatasetVersion,
  ProjectCleaningSummary,
  ProjectWorkflow,
} from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { DataCleaningComponent } from './data-cleaning.component';

const baseSuggestions: CleaningSuggestion[] = [
  {
    id: 'missing', projectId: 10, datasetId: 1, versionId: 11, datasetName: 'customers', issueType: 'Missing Values', column: 'name', count: 2, percentage: 20,
    riskLabel: 'Review', description: 'Missing names',
    recommendedStrategy: { key: 'mode', label: 'Fill mode', operationType: 'fill_missing', parameters: { strategy: 'mode' }, isSafeRecommended: true, isDestructive: false },
    availableStrategies: [
      { key: 'mode', label: 'Fill mode', operationType: 'fill_missing', parameters: { strategy: 'mode' }, isSafeRecommended: true, isDestructive: false },
      { key: 'custom', label: 'Custom value', operationType: 'fill_missing', parameters: { strategy: 'custom', value: null }, isSafeRecommended: false, isDestructive: false },
    ],
  },
  {
    id: 'duplicates', projectId: 10, datasetId: 2, versionId: 12, datasetName: 'orders', issueType: 'Duplicates', column: null, count: 1, percentage: 10,
    riskLabel: 'High', description: 'Duplicate orders',
    recommendedStrategy: { key: 'keep-first', label: 'Keep first', operationType: 'remove_duplicates', parameters: { keep: 'first', columns: [] }, isSafeRecommended: false, isDestructive: true },
    availableStrategies: [{ key: 'keep-first', label: 'Keep first', operationType: 'remove_duplicates', parameters: { keep: 'first', columns: [] }, isSafeRecommended: false, isDestructive: true }],
  },
];

function makeSummary(overrides: Partial<ProjectCleaningSummary> = {}): ProjectCleaningSummary {
  return {
    projectId: 10, projectName: 'Quality project', totalDatasets: 2, analyzedDatasets: 2, unanalyzedDatasets: 0,
    totalRows: 20, totalColumns: 5, totalIssues: 2, rowsAffected: 3, cellsAffected: 2, missingValues: 2,
    duplicateRows: 1, dataQualityScore: null, lastAnalyzedAt: '2026-01-01T00:00:00Z', hasCleaningBatches: false,
    requiresReanalysis: false, canConfirmQuality: false, qualityConfirmed: false, schemaReady: false,
    datasets: [
      { datasetId: 1, datasetName: 'customers', activeVersionId: 11, versionNumber: 1, isRawOriginal: true, rowCount: 10, columnCount: 3, missingValuesCount: 2, duplicateRowsCount: 0, analyzedAt: '2026-01-01T00:00:00Z', requiresReanalysis: false },
      { datasetId: 2, datasetName: 'orders', activeVersionId: 12, versionNumber: 1, isRawOriginal: true, rowCount: 10, columnCount: 2, missingValuesCount: 0, duplicateRowsCount: 1, analyzedAt: '2026-01-01T00:00:00Z', requiresReanalysis: false },
    ],
    issueCounts: { 'Missing Values': 1, Duplicates: 1 },
    ...overrides,
  };
}

function makeWorkflow(overrides: Partial<ProjectWorkflow> = {}): ProjectWorkflow {
  return {
    projectId: 10, projectName: 'Quality project', workflowState: 'Clean', currentStep: 'clean', nextStep: 'schema', recommendedRoute: '/projects/10/clean',
    canImport: true, canAnalyze: true, canClean: true, canBuildSchema: false, canExport: false, canDeploy: false,
    blockerCodes: ['quality_confirmation_required'], blockingReasons: ['Confirm data quality before building Schema.'], schemaStatus: 'NotStarted',
    datasets: [
      { datasetId: 1, datasetName: 'customers', activeVersionId: 11, activeVersionNumber: 1, rowCount: 10, columnCount: 3, hasCurrentAnalysis: true, requiresAnalysis: false, isQualityConfirmed: false },
      { datasetId: 2, datasetName: 'orders', activeVersionId: 12, activeVersionNumber: 1, rowCount: 10, columnCount: 2, hasCurrentAnalysis: true, requiresAnalysis: false, isQualityConfirmed: false },
    ],
    ...overrides,
  };
}

function makePreview(datasetId = 1, sourceVersionId = 11, destructive = false): CleaningPreviewResponse {
  const datasetName = datasetId === 1 ? 'customers' : 'orders';
  const operationId = datasetId === 1 ? 'missing' : 'duplicates';
  return {
    datasets: [{
      datasetId, datasetName, sourceVersionId, executionOrder: [operationId],
      rows: [{ rowNumber: 1, before: datasetId === 1 ? { name: null } : { id: 1 }, after: destructive ? null : { name: 'A' } }],
      operationResults: [{ operationId, operationType: datasetId === 1 ? 'fill_missing' : 'remove_duplicates', column: datasetId === 1 ? 'name' : null, affectedRows: 1, affectedCells: 1, rowsRemoved: destructive ? 1 : 0, columnsRemoved: 0, columnsRenamed: 0, destructive, warnings: [] }],
      affectedRows: 1, affectedCells: 1, rowsRemoved: destructive ? 1 : 0, columnsRemoved: 0, columnsRenamed: 0, destructive, conversionFailures: [], warnings: [],
    }],
    affectedRows: 1, affectedCells: 1, rowsRemoved: destructive ? 1 : 0, columnsRemoved: 0, destructive, warnings: [],
  };
}

function makeApplyResponse(datasetId = 1, versionId = 20, versionNumber = 2): CleaningApplyResponse {
  return {
    batchId: 5, correlationId: 'batch', status: 'Succeeded', rowsAffected: 1, cellsAffected: 1,
    datasets: [{ datasetId, datasetName: datasetId === 1 ? 'customers' : 'orders', success: true, versionId, versionNumber, rowsAffected: 1, cellsAffected: 1 }],
  };
}

const historyEntry: CleaningHistoryEntry = {
  batchId: 5, correlationId: 'batch', name: 'Fill missing', user: 'Owner', createdAt: '2026-01-02T00:00:00Z', completedAt: '2026-01-02T00:01:00Z',
  status: 'Succeeded', isUndo: false, isRestore: false, operationCount: 1, rowsAffected: 1, cellsAffected: 1, canUndo: true,
  operations: [{ id: 1, datasetId: 1, datasetName: 'customers', operationType: 'fill_missing', column: 'name', status: 'Succeeded', rowsAffected: 1, cellsAffected: 1, resultVersionId: 20, resultVersionNumber: 2, isDestructive: false }],
};

interface SetupOptions {
  datasetId?: string;
  summary?: ProjectCleaningSummary;
  workflow?: ProjectWorkflow;
  suggestions?: CleaningSuggestion[];
  preview?: CleaningPreviewResponse;
  history?: CleaningHistoryEntry[];
  versions?: Record<number, DatasetVersion[]>;
  applyResponse?: CleaningApplyResponse;
}

async function setup(options: SetupOptions = {}) {
  const query = new BehaviorSubject(convertToParamMap(options.datasetId === undefined ? {} : { datasetId: options.datasetId }));
  const state = {
    summary: options.summary ?? makeSummary(),
    workflow: options.workflow ?? makeWorkflow(),
    suggestions: options.suggestions ?? structuredClone(baseSuggestions),
    preview: options.preview ?? makePreview(),
    history: options.history ?? [] as CleaningHistoryEntry[],
    versions: options.versions ?? {
      1: [{ id: 11, datasetId: 1, parentVersionId: null, versionNumber: 1, isRawOriginal: true, isActive: true, rowCount: 10, columnCount: 3, operationSummary: 'Imported', createdAt: '2026-01-01T00:00:00Z', analyzedAt: '2026-01-01T00:00:00Z', createdBy: 'Owner' }],
    } as Record<number, DatasetVersion[]>,
    applyResponse: options.applyResponse ?? makeApplyResponse(),
    previewError: null as unknown,
    analysisFailIds: new Set<number>(),
    analysisConflictIds: new Set<number>(),
  };

  const updateAfterVersionResult = (result: CleaningApplyResponse) => {
    for (const changed of result.datasets.filter((dataset) => dataset.success && dataset.versionId != null)) {
      state.summary = {
        ...state.summary,
        hasCleaningBatches: true,
        requiresReanalysis: true,
        canConfirmQuality: false,
        qualityConfirmed: false,
        datasets: state.summary.datasets.map((dataset) => dataset.datasetId === changed.datasetId ? {
          ...dataset,
          activeVersionId: changed.versionId!,
          versionNumber: changed.versionNumber!,
          isRawOriginal: false,
          analyzedAt: null,
          requiresReanalysis: true,
        } : dataset),
      };
      state.workflow = {
        ...state.workflow,
        canClean: false,
        canBuildSchema: false,
        datasets: state.workflow.datasets.map((dataset) => dataset.datasetId === changed.datasetId ? {
          ...dataset,
          activeVersionId: changed.versionId,
          activeVersionNumber: changed.versionNumber,
          hasCurrentAnalysis: false,
          requiresAnalysis: true,
          isQualityConfirmed: false,
        } : dataset),
      };
      state.suggestions = state.suggestions.filter((suggestion) => suggestion.datasetId !== changed.datasetId);
      const prior = state.versions[changed.datasetId] ?? [];
      state.versions = {
        ...state.versions,
        [changed.datasetId]: [
          { id: changed.versionId!, datasetId: changed.datasetId, parentVersionId: prior.find((version) => version.isActive)?.id ?? null, versionNumber: changed.versionNumber!, isRawOriginal: false, isActive: true, rowCount: 10, columnCount: 3, operationSummary: 'Cleaned', createdAt: '2026-01-02T00:00:00Z', analyzedAt: null, createdBy: 'Owner' },
          ...prior.map((version) => ({ ...version, isActive: false })),
        ],
      };
    }
    state.history = [historyEntry];
  };

  const api: Record<string, ReturnType<typeof vi.fn>> = {
    getProjectCleaningSummary: vi.fn(() => of(state.summary)),
    getCleaningSuggestions: vi.fn(() => of(state.suggestions)),
    getCleaningHistory: vi.fn(() => of({ entries: state.history })),
    getProjectWorkflow: vi.fn(() => of(state.workflow)),
    getDatasetVersions: vi.fn((_projectId: number, datasetId: number) => of(state.versions[datasetId] ?? [])),
    previewCleaning: vi.fn(() => state.previewError ? throwError(() => state.previewError) : of(state.preview)),
    applyCleaning: vi.fn(() => {
      updateAfterVersionResult(state.applyResponse);
      return of(state.applyResponse);
    }),
    undoLatestCleaning: vi.fn(() => {
      updateAfterVersionResult(state.applyResponse);
      return of(state.applyResponse);
    }),
    restoreDatasetVersion: vi.fn(() => {
      updateAfterVersionResult(state.applyResponse);
      return of(state.applyResponse);
    }),
    analyzeDataset: vi.fn((datasetId: number) => {
      if (state.analysisConflictIds.has(datasetId)) return throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'The active dataset version changed.' } }));
      if (state.analysisFailIds.has(datasetId)) return throwError(() => new HttpErrorResponse({ status: 502 }));
      state.workflow = {
        ...state.workflow,
        canClean: true,
        datasets: state.workflow.datasets.map((dataset) => dataset.datasetId === datasetId ? { ...dataset, hasCurrentAnalysis: true, requiresAnalysis: false } : dataset),
      };
      state.summary = {
        ...state.summary,
        requiresReanalysis: false,
        canConfirmQuality: true,
        datasets: state.summary.datasets.map((dataset) => dataset.datasetId === datasetId ? { ...dataset, analyzedAt: '2026-01-03T00:00:00Z', requiresReanalysis: false } : dataset),
      };
      const active = state.workflow.datasets.find((dataset) => dataset.datasetId === datasetId)!;
      return of({ datasetId, tableName: active.datasetName, status: 'Analyzed', analysisResult: { rowCount: 10, columnCount: 3, missingValuesCount: 0, duplicateRowsCount: 0, duplicateRowRule: 'exact', columns: [], columnTypeDistribution: [] }, chartRecommendations: [], analyzedAt: '2026-01-03T00:00:00Z', datasetVersionId: active.activeVersionId, datasetVersionNumber: active.activeVersionNumber, isCleanedVersion: true });
    }),
    getDatasetAnalysis: vi.fn((datasetId: number) => {
      const active = state.workflow.datasets.find((dataset) => dataset.datasetId === datasetId)!;
      return of({ datasetId, tableName: active.datasetName, status: 'Analyzed', analysisResult: { rowCount: 10, columnCount: 3, missingValuesCount: 0, duplicateRowsCount: 0, duplicateRowRule: 'exact', columns: [], columnTypeDistribution: [] }, chartRecommendations: [], analyzedAt: '2026-01-03T00:00:00Z', datasetVersionId: active.activeVersionId, datasetVersionNumber: active.activeVersionNumber, isCleanedVersion: true });
    }),
    confirmCleaningQuality: vi.fn(() => {
      state.summary = { ...state.summary, qualityConfirmed: true, canConfirmQuality: false, schemaReady: true };
      state.workflow = { ...state.workflow, canBuildSchema: true, blockingReasons: [], blockerCodes: [], datasets: state.workflow.datasets.map((dataset) => ({ ...dataset, isQualityConfirmed: true })) };
      return of({ projectId: 10, qualityConfirmed: true, schemaReady: true, confirmedAt: '2026-01-04T00:00:00Z', confirmedVersions: {} });
    }),
  };

  await TestBed.configureTestingModule({
    imports: [DataCleaningComponent],
    providers: [
      provideRouter([]),
      { provide: ForgeApiService, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectId: '10' }) }, queryParamMap: query.asObservable() } },
    ],
  }).compileComponents();
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(DataCleaningComponent);
  fixture.detectChanges();
  await Promise.resolve();
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, api, state, navigate, context: TestBed.inject(ProjectWorkflowContextService) };
}

describe('DataCleaningComponent', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('uses project scope when datasetId is absent', async () => {
    const { component } = await setup();
    expect(component.stateService.scope()).toBe('project');
    expect(component.stateService.filteredSuggestions()).toHaveLength(2);
  });

  it('uses a valid dataset scope and loads its version history', async () => {
    const { component, api } = await setup({ datasetId: '1' });
    expect(component.stateService.scope()).toBe(1);
    expect(component.stateService.filteredSuggestions().map((suggestion) => suggestion.id)).toEqual(['missing']);
    expect(api['getDatasetVersions']).toHaveBeenCalledWith(10, 1);
  });

  it('updates the URL and version history when the user changes cleaning scope', async () => {
    const { component, api, navigate } = await setup();

    component.changeScope(1);
    await Promise.resolve();
    expect(component.stateService.scope()).toBe(1);
    expect(api['getDatasetVersions']).toHaveBeenCalledWith(10, 1);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({
      replaceUrl: false,
      queryParams: expect.objectContaining({ datasetId: 1 }),
    }));

    component.changeScope('project');
    expect(component.stateService.scope()).toBe('project');
    expect(component.apiService.versions()).toEqual({});
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({
      replaceUrl: false,
      queryParams: expect.objectContaining({ datasetId: null }),
    }));
  });

  it('removes an invalid datasetId and returns to project scope with one notice', async () => {
    const { component, navigate } = await setup({ datasetId: '999' });
    expect(component.stateService.scope()).toBe('project');
    expect(component.stateService.scopeNotice()).toContain('not in this project');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ replaceUrl: true, queryParams: expect.objectContaining({ datasetId: null }) }));
  });

  it('shows a no-datasets state without cleaning controls', async () => {
    const { fixture } = await setup({
      summary: makeSummary({ totalDatasets: 0, analyzedDatasets: 0, datasets: [], totalIssues: 0 }),
      workflow: makeWorkflow({ canClean: false, datasets: [] }),
      suggestions: [],
    });
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="cleaning-empty-state"]')).toBeTruthy();
    expect(element.querySelector('[data-testid="cleaning-issues"]')).toBeNull();
    expect(element.textContent).toContain('Go to Data');
  });

  it('blocks cleaning and names datasets whose active versions require analysis', async () => {
    const workflow = makeWorkflow({
      canClean: false,
      datasets: makeWorkflow().datasets.map((dataset) => dataset.datasetId === 1 ? { ...dataset, hasCurrentAnalysis: false, requiresAnalysis: true } : dataset),
    });
    const { fixture } = await setup({ workflow });
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="analysis-required-state"]')?.textContent).toContain('customers');
    expect(element.querySelector('[data-testid="cleaning-issues"]')).toBeNull();
  });

  it('supports quality confirmation when analysis finds no issues without creating a version', async () => {
    const { component, api } = await setup({ summary: makeSummary({ totalIssues: 0, canConfirmQuality: true }), suggestions: [] });
    expect(component.apiService.canConfirmQuality()).toBe(true);
    await component.confirmQuality();
    expect(api['confirmCleaningQuality']).toHaveBeenCalledWith(10);
    expect(api['applyCleaning']).not.toHaveBeenCalled();
    expect(component.apiService.summary()?.qualityConfirmed).toBe(true);
  });

  it('only offers project-wide quality confirmation from the all-datasets scope', async () => {
    const { fixture } = await setup({
      datasetId: '1',
      summary: makeSummary({ canConfirmQuality: true }),
    });
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="confirm-quality"]')).toBeNull();
    expect(element.querySelector('[data-testid="review-project-quality"]')).toBeTruthy();
    expect(element.querySelector('[data-testid="quality-confirmation"]')?.textContent)
      .toContain('Confirmation applies to every active dataset version');
  });

  it('uses the selected custom-value strategy and carries the expected source version', async () => {
    const { component, api } = await setup();
    component.stateService.updateStrategy(baseSuggestions[0], 'custom');
    component.stateService.updateCustomValue('missing', 'Unknown');
    await component.previewSuggestion(baseSuggestions[0]);
    expect(api['previewCleaning']).toHaveBeenCalledWith(10, { operations: [expect.objectContaining({ expectedSourceVersionId: 11, parameters: { strategy: 'custom', value: 'Unknown' } })] });
  });

  it('blocks a custom replacement until a non-blank value is provided', async () => {
    const { component, api } = await setup();
    component.stateService.updateStrategy(baseSuggestions[0], 'custom');
    component.stateService.updateCustomValue('missing', '   ');

    await component.previewSuggestion(baseSuggestions[0]);

    expect(api['previewCleaning']).not.toHaveBeenCalled();
    expect(component.apiService.feedback()).toEqual({
      kind: 'error',
      title: 'Complete the cleaning strategy',
      message: 'Custom strategy requires a replacement value.',
    });
  });

  it('passes duplicate identifying columns only for the duplicate strategy', async () => {
    const preview = makePreview(2, 12, true);
    const { component, api } = await setup({ preview });
    component.stateService.updateDuplicateColumns('duplicates', 'id, created_at');
    await component.previewSuggestion(baseSuggestions[1]);
    expect(api['previewCleaning'].mock.calls[0][1].operations[0].parameters.columns).toEqual(['id', 'created_at']);
  });

  it('treats the duplicate-columns value All as all columns', async () => {
    const { component, api } = await setup({ preview: makePreview(2, 12, true) });
    component.stateService.updateDuplicateColumns('duplicates', 'All');

    await component.previewSuggestion(baseSuggestions[1]);

    expect(api['previewCleaning'].mock.calls[0][1].operations[0].parameters.columns).toEqual([]);
  });

  it('previews only safe non-destructive recommended fixes', async () => {
    const { component, api } = await setup();
    await component.previewRecommendedFixes();
    const operations = api['previewCleaning'].mock.calls[0][1].operations;
    expect(operations.map((operation: { suggestionId: string }) => operation.suggestionId)).toEqual(['missing']);
    expect(component.stateService.selectedIds().has('duplicates')).toBe(false);
  });

  it('ignores a destructive override when previewing safe recommendations', async () => {
    const suggestion = structuredClone(baseSuggestions[0]);
    suggestion.riskLabel = 'Low — deterministic';
    suggestion.availableStrategies.push({
      key: 'delete',
      label: 'Delete affected rows',
      operationType: 'fill_missing',
      parameters: { strategy: 'delete_rows' },
      isSafeRecommended: false,
      isDestructive: true,
    });
    const { component, api } = await setup({ suggestions: [suggestion] });
    component.stateService.updateStrategy(suggestion, 'delete');

    await component.previewRecommendedFixes();

    expect(api['previewCleaning'].mock.calls[0][1].operations[0]).toEqual(expect.objectContaining({
      operationType: 'fill_missing',
      parameters: { strategy: 'mode' },
    }));
    expect(component.stateService.selectedStrategy(suggestion).key).toBe(suggestion.recommendedStrategy.key);
  });

  it('clears preview selections when the user cancels the preview', async () => {
    const { component } = await setup();
    await component.previewRecommendedFixes();
    expect(component.stateService.selectedIds().size).toBeGreaterThan(0);

    component.closePreview();

    expect(component.stateService.selectedIds().size).toBe(0);
    expect(component.stateService.strategyOverrides()).toEqual({});
  });

  it('labels the currently selected destructive strategy as high risk', async () => {
    const suggestion = structuredClone(baseSuggestions[0]);
    suggestion.riskLabel = 'Low — deterministic';
    suggestion.availableStrategies.push({
      key: 'delete',
      label: 'Delete affected rows',
      operationType: 'fill_missing',
      parameters: { strategy: 'delete_rows' },
      isSafeRecommended: false,
      isDestructive: true,
    });
    const { component, fixture } = await setup({ suggestions: [suggestion] });

    component.stateService.updateStrategy(suggestion, 'delete');
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('[data-testid="cleaning-issue-card"]') as HTMLElement;
    expect(card.textContent).toContain('High — destructive');
    expect(card.textContent).not.toContain('Low — deterministic');
  });

  it('previews selected issues together', async () => {
    const combined = makePreview();
    combined.datasets.push(makePreview(2, 12, true).datasets[0]);
    combined.destructive = true;
    const { component, api } = await setup({ preview: combined });
    component.stateService.toggleSuggestion(baseSuggestions[0]);
    component.stateService.toggleSuggestion(baseSuggestions[1]);
    await component.previewSelected();
    expect(api['previewCleaning'].mock.calls[0][1].operations).toHaveLength(2);
  });

  it('locks issue-card and bulk plan controls during preview, apply, and re-analysis', async () => {
    const { component, fixture } = await setup();
    component.stateService.toggleSuggestion(baseSuggestions[0]);
    component.stateService.updateStrategy(baseSuggestions[0], 'custom');
    fixture.detectChanges();

    const planControls = () => Array.from(fixture.nativeElement.querySelectorAll(
      '[data-testid="issue-selection"], [data-testid="issue-strategy"], [data-testid="issue-custom-value"], '
      + '[data-testid="issue-duplicate-columns"], [data-testid="select-visible-issues"], '
      + '[data-testid="bulk-strategy"], [data-testid="preview-selected-issues"]',
    )) as Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>;
    const busySignals = [
      component.apiService.previewLoading,
      component.apiService.applyLoading,
      component.apiService.reanalyzing,
    ];

    expect(planControls()).toHaveLength(8);
    for (const busy of busySignals) {
      busy.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const states = planControls().map((control) => ({
        control: control.dataset['testid'],
        disabled: control.disabled,
      }));
      expect(states).toEqual(states.map((state) => ({ ...state, disabled: true })));
      busy.set(false);
      fixture.detectChanges();
      await fixture.whenStable();
    }

    fixture.detectChanges();
    expect(planControls().every((control) => !control.disabled)).toBe(true);
  });

  it('locks preview operation removal and destructive confirmation while preview refreshes or applies', async () => {
    const combined = makePreview();
    combined.datasets.push(makePreview(2, 12, true).datasets[0]);
    combined.destructive = true;
    const { component, fixture } = await setup({ preview: combined });
    component.stateService.toggleSuggestion(baseSuggestions[0]);
    component.stateService.toggleSuggestion(baseSuggestions[1]);
    await component.previewSelected();
    fixture.detectChanges();

    const modalControls = () => Array.from(fixture.nativeElement.querySelectorAll(
      '[data-testid="remove-preview-operation"], [data-testid="destructive-confirmation-checkbox"]',
    )) as Array<HTMLInputElement | HTMLButtonElement>;

    expect(modalControls()).toHaveLength(3);
    for (const busy of [component.apiService.previewLoading, component.apiService.applyLoading]) {
      busy.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const states = modalControls().map((control) => ({
        control: control.dataset['testid'],
        disabled: control.disabled,
      }));
      expect(states).toEqual(states.map((state) => ({ ...state, disabled: true })));
      busy.set(false);
      fixture.detectChanges();
      await fixture.whenStable();
    }

    fixture.detectChanges();
    expect(modalControls().every((control) => !control.disabled)).toBe(true);
  });

  it('shows actionable conversion failures in the cleaning preview', async () => {
    const preview = makePreview();
    preview.datasets[0].conversionFailures = [{
      rowNumber: 7,
      column: 'amount',
      value: 'not-a-number',
      reason: 'Value is not a valid decimal.',
    }];
    const { component, fixture } = await setup({ preview });

    await component.previewSuggestion(baseSuggestions[0]);
    fixture.detectChanges();

    const failures = fixture.nativeElement.querySelector('[data-testid="conversion-failures"]') as HTMLElement;
    expect(failures.getAttribute('role')).toBe('alert');
    expect(failures.textContent).toContain('1 value(s) could not be converted');
    expect(failures.textContent).toContain('Row 7');
    expect(failures.textContent).toContain('amount');
    expect(failures.textContent).toContain('not-a-number');
    expect(failures.textContent).toContain('Value is not a valid decimal.');
  });

  it('rejects a preview response that omits one of the requested datasets', async () => {
    const { component } = await setup({ preview: makePreview(1, 11) });
    component.stateService.toggleSuggestion(baseSuggestions[0]);
    component.stateService.toggleSuggestion(baseSuggestions[1]);

    await component.previewSelected();

    expect(component.apiService.preview()).toBeNull();
    expect(component.apiService.feedback()?.title).toBe('Preview incomplete');
    expect(component.stateService.selectedIds().size).toBe(0);
  });

  it('surfaces preview HTTP failures without rejecting the UI action', async () => {
    const { component, state } = await setup();
    state.previewError = new HttpErrorResponse({ status: 502, error: { detail: 'Preview service unavailable.' } });

    await expect(component.previewSuggestion(baseSuggestions[0])).resolves.toBeUndefined();

    expect(component.apiService.preview()).toBeNull();
    expect(component.apiService.feedback()).toEqual(expect.objectContaining({
      kind: 'error',
      title: 'Preview failed',
      message: 'Preview service unavailable.',
    }));
  });

  it('ignores a preview response after the user abandons that pending plan', async () => {
    const pending = new Subject<CleaningPreviewResponse>();
    const { component, api } = await setup();
    api['previewCleaning'].mockReturnValue(pending);

    const request = component.previewSuggestion(baseSuggestions[0]);
    expect(component.apiService.previewLoading()).toBe(true);
    component.closePreview();
    pending.next(makePreview());
    pending.complete();
    await request;

    expect(component.apiService.preview()).toBeNull();
    expect(component.apiService.previewOperations()).toEqual([]);
    expect(component.apiService.previewLoading()).toBe(false);
  });

  it('requires explicit confirmation before applying destructive operations', async () => {
    const { component, api, state } = await setup({ preview: makePreview(2, 12, true), applyResponse: makeApplyResponse(2, 22, 2) });
    await component.previewSuggestion(baseSuggestions[1]);
    await component.applyPreview();
    expect(api['applyCleaning']).not.toHaveBeenCalled();
    component.apiService.destructiveConfirmed.set(true);
    await component.applyPreview();
    expect(api['applyCleaning']).toHaveBeenCalled();
    expect(state.versions[2]).toHaveLength(1);
  });

  it('invalidates selection and refreshes workflow after a stale-preview conflict', async () => {
    const { component, api, state } = await setup();
    state.previewError = new HttpErrorResponse({ status: 409, error: { code: 'active_version_changed', message: 'changed' } });
    component.stateService.toggleSuggestion(baseSuggestions[0]);
    await component.previewSelected();
    expect(component.apiService.preview()).toBeNull();
    expect(component.stateService.selectedIds().size).toBe(0);
    expect(component.apiService.feedback()?.message).toContain('preview again');
    expect(api['getProjectWorkflow'].mock.calls.length).toBeGreaterThan(1);
  });

  it('displays a newly active cleaning version and automatically analyzes it', async () => {
    const { component, api, state } = await setup();
    await component.previewSuggestion(baseSuggestions[0]);
    await component.applyPreview();
    expect(component.apiService.datasets().find((dataset) => dataset.datasetId === 1)?.versionNumber).toBe(2);
    expect(state.versions[1][0].isActive).toBe(true);
    expect(api['analyzeDataset']).toHaveBeenCalledWith(1, { analysisType: 'profile' });
    expect(api['getDatasetAnalysis']).toHaveBeenCalledWith(1);
    expect(api['getDatasetVersions']).toHaveBeenCalledWith(10, 1);
    expect(api['getCleaningHistory'].mock.calls.length).toBeGreaterThan(1);
  });

  it('automatically analyzes only datasets that successfully created versions', async () => {
    const partial: CleaningApplyResponse = {
      ...makeApplyResponse(), status: 'PartiallySucceeded',
      datasets: [makeApplyResponse().datasets[0], { datasetId: 2, datasetName: 'orders', success: false, rowsAffected: 0, cellsAffected: 0, error: 'failed' }],
    };
    const { component, api } = await setup({ applyResponse: partial });
    await component.previewSuggestion(baseSuggestions[0]);
    await component.applyPreview();
    expect(api['analyzeDataset']).toHaveBeenCalledTimes(1);
    expect(api['analyzeDataset']).toHaveBeenCalledWith(1, { analysisType: 'profile' });
  });

  it('reports cleaning and re-analysis failures together after a partial batch', async () => {
    const partial: CleaningApplyResponse = {
      ...makeApplyResponse(),
      status: 'PartiallySucceeded',
      datasets: [
        makeApplyResponse().datasets[0],
        { datasetId: 2, datasetName: 'orders', success: false, rowsAffected: 0, cellsAffected: 0, error: 'failed' },
      ],
    };
    const { component, state } = await setup({ applyResponse: partial });
    state.analysisFailIds.add(1);

    await component.previewSuggestion(baseSuggestions[0]);
    await component.applyPreview();

    expect(component.apiService.feedback()?.title).toBe('Cleaning partially applied; re-analysis incomplete');
    expect(component.apiService.feedback()?.message).toContain('cleaning failed for: orders: failed');
    expect(component.apiService.feedback()?.message).toContain('analysis failed for: customers');
  });

  it('preserves cleaned versions and exposes retry after partial automatic analysis failure', async () => {
    const { component, state } = await setup();
    state.analysisFailIds.add(1);
    await component.previewSuggestion(baseSuggestions[0]);
    await component.applyPreview();
    expect(component.apiService.analysisFailures().map((failure) => failure.datasetId)).toEqual([1]);
    expect(component.apiService.feedback()?.title).toContain('re-analysis incomplete');
    expect(state.versions[1][0].versionNumber).toBe(2);
  });

  it('retries analysis only for failed datasets that still require it', async () => {
    const { component, api, state } = await setup();
    state.analysisFailIds.add(1);
    await component.previewSuggestion(baseSuggestions[0]);
    await component.applyPreview();
    state.analysisFailIds.delete(1);
    api['analyzeDataset'].mockClear();
    await component.retryAnalysis();
    expect(api['analyzeDataset']).toHaveBeenCalledTimes(1);
    expect(api['analyzeDataset']).toHaveBeenCalledWith(1, { analysisType: 'profile' });
    expect(component.apiService.analysisFailures()).toEqual([]);
  });

  it('handles active-version conflict during automatic analysis without marking success', async () => {
    const { component, state } = await setup();
    state.analysisConflictIds.add(1);
    await component.previewSuggestion(baseSuggestions[0]);
    await component.applyPreview();
    expect(component.apiService.analysisFailures()[0]?.conflict).toBe(true);
    expect(component.apiService.feedback()?.kind).toBe('warning');
  });

  it('force-refreshes workflow after apply and analysis', async () => {
    const { component, api } = await setup();
    await component.previewSuggestion(baseSuggestions[0]);
    await component.applyPreview();
    expect(api['getProjectWorkflow'].mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('locks dataset opening, Undo, and schema navigation during version work', async () => {
    const { component, fixture, navigate } = await setup({
      history: [historyEntry],
      workflow: makeWorkflow({ canBuildSchema: true, blockingReasons: [] }),
    });
    component.apiService.applyLoading.set(true);
    fixture.detectChanges();

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const openButton = buttons.find((button) => button.textContent?.trim() === 'Open')!;
    const undoButton = buttons.find((button) => button.textContent?.includes('Undo as new active version'))!;
    const continueButton = fixture.nativeElement.querySelector('[data-testid="continue-to-schema"]') as HTMLButtonElement;
    expect(openButton.disabled).toBe(true);
    expect(undoButton.disabled).toBe(true);
    expect(continueButton.disabled).toBe(true);

    component.openDataset(1);
    component.requestUndo();
    component.continueToSchema();

    expect(component.stateService.scope()).toBe('project');
    expect(component.apiService.confirmAction()).toBeNull();
    expect(navigate).not.toHaveBeenCalledWith(
      ['/projects', 10, 'schema'],
      expect.anything(),
    );
  });

  it('locks Restore while preview or re-analysis owns the cleaning snapshot', async () => {
    const old: DatasetVersion = { id: 11, datasetId: 1, parentVersionId: null, versionNumber: 1, isRawOriginal: true, isActive: false, rowCount: 10, columnCount: 3, operationSummary: 'Imported', createdAt: '2026-01-01T00:00:00Z', analyzedAt: '2026-01-01T00:00:00Z', createdBy: 'Owner' };
    const active: DatasetVersion = { ...old, id: 20, versionNumber: 2, isRawOriginal: false, isActive: true, operationSummary: 'Cleaned' };
    const { component, fixture } = await setup({ datasetId: '1', versions: { 1: [active, old] } });
    component.apiService.reanalyzing.set(true);
    fixture.detectChanges();

    const restoreButton = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Restore as new active version'))!;
    expect(restoreButton.disabled).toBe(true);

    component.requestRestore(1, old);
    expect(component.apiService.confirmAction()).toBeNull();
  });

  it('undoes the latest batch as a new active version and analyzes it', async () => {
    const { component, api } = await setup({ history: [historyEntry] });
    component.requestUndo();
    await component.confirmUndoOrRestore();
    expect(api['undoLatestCleaning']).toHaveBeenCalledWith(10);
    expect(api['analyzeDataset']).toHaveBeenCalledWith(1, { analysisType: 'profile' });
    expect(api['getDatasetVersions']).toHaveBeenCalledWith(10, 1);
  });

  it('moves focus to the stable page heading after a successful Undo', async () => {
    const { component, fixture } = await setup({ history: [historyEntry] });
    const undoButton = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Undo as new active version'))!;
    undoButton.focus();

    component.requestUndo();
    await component.confirmUndoOrRestore();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));

    expect(document.activeElement?.textContent).toBe('Data Cleaning');
  });

  it('restores a historical version as a new active version and analyzes it', async () => {
    const old: DatasetVersion = { id: 11, datasetId: 1, parentVersionId: null, versionNumber: 1, isRawOriginal: true, isActive: false, rowCount: 10, columnCount: 3, operationSummary: 'Imported', createdAt: '2026-01-01T00:00:00Z', analyzedAt: '2026-01-01T00:00:00Z', createdBy: 'Owner' };
    const active: DatasetVersion = { ...old, id: 20, versionNumber: 2, isRawOriginal: false, isActive: true, operationSummary: 'Cleaned' };
    const { component, api } = await setup({ datasetId: '1', versions: { 1: [active, old] }, applyResponse: makeApplyResponse(1, 21, 3) });
    component.requestRestore(1, old);
    await component.confirmUndoOrRestore();
    expect(api['restoreDatasetVersion']).toHaveBeenCalledWith(10, 1, 11);
    expect(api['analyzeDataset']).toHaveBeenCalledWith(1, { analysisType: 'profile' });
    expect(api['getDatasetVersions'].mock.calls.filter((call) => call[1] === 1).length).toBeGreaterThanOrEqual(2);
  });

  it('refreshes workflow after quality confirmation', async () => {
    const { component, api } = await setup({ summary: makeSummary({ totalIssues: 0, canConfirmQuality: true }), suggestions: [] });
    const before = api['getProjectWorkflow'].mock.calls.length;
    await component.confirmQuality();
    expect(api['getProjectWorkflow'].mock.calls.length).toBeGreaterThan(before);
    expect(component.apiService.canContinueToSchema()).toBe(true);
  });

  it('moves focus to the stable page heading after quality confirmation removes its action', async () => {
    const { component, fixture } = await setup({
      summary: makeSummary({ totalIssues: 0, canConfirmQuality: true }),
      suggestions: [],
    });
    const confirm = fixture.nativeElement.querySelector('[data-testid="confirm-quality"]') as HTMLButtonElement;
    confirm.focus();

    await component.confirmQuality();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));

    expect(document.activeElement?.textContent).toBe('Data Cleaning');
  });

  it('uses workflow canBuildSchema and preserves datasetId when continuing', async () => {
    const { component, navigate } = await setup({ datasetId: '1', workflow: makeWorkflow({ canBuildSchema: true, blockingReasons: [] }) });
    component.continueToSchema();
    expect(navigate).toHaveBeenCalledWith(['/projects', 10, 'schema'], { queryParams: { datasetId: 1 } });
  });

  it('does not navigate to Schema when workflow canBuildSchema is false even if summary schemaReady is true', async () => {
    const { component, navigate } = await setup({ summary: makeSummary({ schemaReady: true }), workflow: makeWorkflow({ canBuildSchema: false }) });
    component.continueToSchema();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps previous versions visible in the collapsible history', async () => {
    const old: DatasetVersion = { id: 11, datasetId: 1, parentVersionId: null, versionNumber: 1, isRawOriginal: true, isActive: false, rowCount: 10, columnCount: 3, operationSummary: 'Imported', createdAt: '2026-01-01T00:00:00Z', analyzedAt: '2026-01-01T00:00:00Z', createdBy: 'Owner' };
    const active: DatasetVersion = { ...old, id: 20, versionNumber: 2, isRawOriginal: false, isActive: true, operationSummary: 'Cleaned' };
    const { fixture } = await setup({ datasetId: '1', versions: { 1: [active, old] } });
    const history = fixture.nativeElement.querySelector('[data-testid="dataset-version-history"]') as HTMLElement;
    expect(history.textContent).toContain('v1');
    expect(history.textContent).toContain('v2');
    expect(history.textContent).toContain('Restore as new active version');
  });

  it('renders one scrolling workspace without legacy rails or six-card dashboard', async () => {
    const { fixture } = await setup();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.left-rail, .right-rail, .metric-grid')).toBeNull();
    expect(element.textContent).not.toContain('By Type');
    expect(element.textContent).not.toContain('Fix All');
    expect(element.querySelectorAll('[data-testid="cleaning-issue-card"]')).toHaveLength(2);
  });
});
