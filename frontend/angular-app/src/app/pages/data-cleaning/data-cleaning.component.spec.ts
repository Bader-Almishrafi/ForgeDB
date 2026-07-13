import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CleaningApplyResponse, CleaningPreviewResponse, CleaningSuggestion, ProjectCleaningSummary } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { DataCleaningComponent } from './data-cleaning.component';

const summary: ProjectCleaningSummary = {
  projectId: 10, projectName: 'Quality project', totalDatasets: 2, analyzedDatasets: 2, unanalyzedDatasets: 0,
  totalRows: 20, totalColumns: 5, totalIssues: 2, rowsAffected: 3, cellsAffected: 2, missingValues: 2,
  duplicateRows: 1, dataQualityScore: null, lastAnalyzedAt: '2026-01-01T00:00:00Z', hasCleaningBatches: false,
  requiresReanalysis: false, canConfirmQuality: false, qualityConfirmed: false, schemaReady: false,
  datasets: [
    { datasetId: 1, datasetName: 'customers', activeVersionId: 11, versionNumber: 1, isRawOriginal: true, rowCount: 10, columnCount: 3, missingValuesCount: 2, duplicateRowsCount: 0, analyzedAt: '2026-01-01T00:00:00Z', requiresReanalysis: false },
    { datasetId: 2, datasetName: 'orders', activeVersionId: 12, versionNumber: 1, isRawOriginal: true, rowCount: 10, columnCount: 2, missingValuesCount: 0, duplicateRowsCount: 1, analyzedAt: '2026-01-01T00:00:00Z', requiresReanalysis: false },
  ], issueCounts: { 'Missing Values': 1, Duplicates: 1 },
};

const suggestions: CleaningSuggestion[] = [
  {
    id: 'missing', projectId: 10, datasetId: 1, versionId: 11, datasetName: 'customers', issueType: 'Missing Values', column: 'name', count: 2, percentage: 20,
    riskLabel: 'Review', description: 'Missing names',
    recommendedStrategy: { key: 'mode', label: 'Fill mode', operationType: 'fill_missing', parameters: { strategy: 'mode' }, isSafeRecommended: true, isDestructive: false },
    availableStrategies: [
      { key: 'mode', label: 'Fill mode', operationType: 'fill_missing', parameters: { strategy: 'mode' }, isSafeRecommended: true, isDestructive: false },
      { key: 'custom', label: 'Custom', operationType: 'fill_missing', parameters: { strategy: 'custom', value: null }, isSafeRecommended: false, isDestructive: false },
    ],
  },
  {
    id: 'duplicates', projectId: 10, datasetId: 2, versionId: 12, datasetName: 'orders', issueType: 'Duplicates', column: null, count: 1, percentage: 10,
    riskLabel: 'High', description: 'Duplicate orders',
    recommendedStrategy: { key: 'keep-first', label: 'Keep first', operationType: 'remove_duplicates', parameters: { keep: 'first', columns: ['id'] }, isSafeRecommended: false, isDestructive: true },
    availableStrategies: [{ key: 'keep-first', label: 'Keep first', operationType: 'remove_duplicates', parameters: { keep: 'first', columns: ['id'] }, isSafeRecommended: false, isDestructive: true }],
  },
];

const preview: CleaningPreviewResponse = {
  datasets: [{ datasetId: 1, datasetName: 'customers', sourceVersionId: 11, executionOrder: ['missing'], rows: [{ rowNumber: 1, before: { name: null }, after: { name: 'A' } }], operationResults: [{ operationId: 'missing', operationType: 'fill_missing', column: 'name', affectedRows: 1, affectedCells: 1, rowsRemoved: 0, columnsRemoved: 0, columnsRenamed: 0, destructive: false, warnings: [] }], affectedRows: 1, affectedCells: 1, rowsRemoved: 0, columnsRemoved: 0, columnsRenamed: 0, destructive: false, conversionFailures: [], warnings: [] }],
  affectedRows: 1, affectedCells: 1, rowsRemoved: 0, columnsRemoved: 0, destructive: false, warnings: [],
};

function applyResponse(status = 'Succeeded'): CleaningApplyResponse {
  return { batchId: 1, correlationId: 'run', status, rowsAffected: 1, cellsAffected: 1, datasets: status === 'PartiallySucceeded'
    ? [{ datasetId: 1, datasetName: 'customers', success: true, versionId: 20, versionNumber: 2, rowsAffected: 1, cellsAffected: 1 }, { datasetId: 2, datasetName: 'orders', success: false, rowsAffected: 0, cellsAffected: 0, error: 'failed' }]
    : [{ datasetId: 1, datasetName: 'customers', success: true, versionId: 20, versionNumber: 2, rowsAffected: 1, cellsAffected: 1 }] };
}

describe('DataCleaningComponent', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let component: DataCleaningComponent;

  beforeEach(async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() });
    api = {
      getProjectCleaningSummary: vi.fn(() => of(summary)),
      getCleaningSuggestions: vi.fn(() => of(suggestions)),
      getCleaningHistory: vi.fn(() => of({ entries: [] })),
      getDatasetVersions: vi.fn(() => of([])),
      previewCleaning: vi.fn(() => of(preview)),
      applyCleaning: vi.fn(() => of(applyResponse())),
      undoLatestCleaning: vi.fn(() => of(applyResponse())),
      restoreDatasetVersion: vi.fn(() => of(applyResponse())),
      analyzeDataset: vi.fn(() => of({})),
      confirmCleaningQuality: vi.fn(() => of({ projectId: 10, qualityConfirmed: true, schemaReady: true, confirmedAt: '', confirmedVersions: {} })),
    };
    await TestBed.configureTestingModule({
      imports: [DataCleaningComponent],
      providers: [
        provideRouter([]),
        { provide: ForgeApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectId: '10' }), queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DataCleaningComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads with All Project Data as the default scope', () => {
    expect(component.scope()).toBe('project');
    expect(component.summary()?.projectName).toBe('Quality project');
    expect(component.filteredSuggestions()).toHaveLength(2);
  });

  it('selects a dataset and filters issues by dataset and type', () => {
    component.selectDataset(summary.datasets[0]);
    expect(component.filteredSuggestions().map((item) => item.id)).toEqual(['missing']);
    component.updateIssueType('Duplicates');
    expect(component.filteredSuggestions()).toHaveLength(0);
  });

  it('validates strategy customization and sends it in preview requests', async () => {
    component.updateStrategy(suggestions[0], 'custom');
    component.updateCustomValue('missing', 'Unknown');
    await component.previewSuggestion(suggestions[0]);
    expect(api['previewCleaning']).toHaveBeenCalledWith(10, { operations: [expect.objectContaining({ parameters: { strategy: 'custom', value: 'Unknown' } })] });
    expect(component.preview()?.affectedRows).toBe(1);
  });

  it('selects multiple issues and previews them as one ordered request', async () => {
    component.toggleSuggestion(suggestions[0]);
    component.toggleSuggestion(suggestions[1]);
    await component.previewSelected();
    expect(api['previewCleaning'].mock.calls[0][1].operations).toHaveLength(2);
  });

  it('Fix All review contains only safe recommendations', () => {
    component.openFixAllReview();
    expect(component.fixAllIds().has('missing')).toBe(true);
    expect(component.fixAllIds().has('duplicates')).toBe(false);
  });

  it('reports partial apply failures honestly', async () => {
    api['applyCleaning'].mockReturnValue(of(applyResponse('PartiallySucceeded')));
    await component.previewSuggestion(suggestions[0]);
    await component.applyPreview();
    expect(component.feedback()?.kind).toBe('warning');
    expect(component.feedback()?.message).toContain('orders');
  });

  it('closes and clears the preview dialog after a successful apply', async () => {
    const dialog = component.previewDialog()?.nativeElement;
    await component.previewSuggestion(suggestions[0]);

    await component.applyPreview();

    expect(dialog?.close).toHaveBeenCalled();
    expect(component.preview()).toBeNull();
    expect(component.previewOperations()).toEqual([]);
  });

  it('loads history and exposes persisted undo and restore actions', async () => {
    component.confirmAction.set({ kind: 'undo' });
    await component.confirmUndoOrRestore();
    expect(api['undoLatestCleaning']).toHaveBeenCalledWith(10);
    const version = { id: 1, datasetId: 1, parentVersionId: null, versionNumber: 1, isRawOriginal: true, isActive: false, rowCount: 10, columnCount: 3, operationSummary: 'Raw', createdAt: '', analyzedAt: '', createdBy: 'Owner' };
    component.confirmAction.set({ kind: 'restore', datasetId: 1, version });
    await component.confirmUndoOrRestore();
    expect(api['restoreDatasetVersion']).toHaveBeenCalledWith(10, 1, 1);
  });

  it('enables Schema navigation only through persisted summary readiness', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.continueToSchema();
    expect(navigate).not.toHaveBeenCalled();
    component.summary.set({ ...summary, schemaReady: true });
    component.continueToSchema();
    expect(navigate).toHaveBeenCalledWith(['/projects', 10, 'schema-designer'], { queryParams: { returnTo: 'data-cleaning' } });
  });
});
