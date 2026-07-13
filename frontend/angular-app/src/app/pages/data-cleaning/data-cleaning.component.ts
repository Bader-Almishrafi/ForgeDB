import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideCheck,
  LucideCheckCircle2,
  LucideChevronDown,
  LucideCircleAlert,
  LucideClock3,
  LucideDatabase,
  LucideHistory,
  LucideLayers3,
  LucideListChecks,
  LucidePlay,
  LucideRefreshCw,
  LucideRotateCcw,
  LucideSearch,
  LucideShieldCheck,
  LucideSparkles,
  LucideTable2,
  LucideTriangleAlert,
  LucideWandSparkles,
  LucideX,
} from '@lucide/angular';
import { firstValueFrom, forkJoin } from 'rxjs';
import {
  CleaningApplyResponse,
  CleaningHistoryEntry,
  CleaningOperationRequest,
  CleaningPreviewResponse,
  CleaningStrategy,
  CleaningSuggestion,
  DatasetCleaningSummary,
  DatasetVersion,
  ProjectCleaningSummary,
} from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

type CleaningScope = 'project' | number;
type RailMode = 'type' | 'dataset';
type ConfirmAction = { kind: 'undo' } | { kind: 'restore'; datasetId: number; version: DatasetVersion };

interface FeedbackMessage {
  kind: 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

@Component({
  selector: 'app-data-cleaning',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    LucideArrowLeft,
    LucideCheck,
    LucideCheckCircle2,
    LucideChevronDown,
    LucideCircleAlert,
    LucideClock3,
    LucideDatabase,
    LucideHistory,
    LucideLayers3,
    LucideListChecks,
    LucidePlay,
    LucideRefreshCw,
    LucideRotateCcw,
    LucideSearch,
    LucideShieldCheck,
    LucideSparkles,
    LucideTable2,
    LucideTriangleAlert,
    LucideWandSparkles,
    LucideX,
    NgClass,
    RouterLink,
  ],
  templateUrl: './data-cleaning.component.html',
  styleUrl: './data-cleaning.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataCleaningComponent implements OnInit {
  private readonly api = inject(ForgeApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly workflow = inject(WorkflowStateService);

  readonly previewDialog = viewChild<ElementRef<HTMLDialogElement>>('previewDialog');
  readonly fixAllDialog = viewChild<ElementRef<HTMLDialogElement>>('fixAllDialog');
  readonly confirmDialog = viewChild<ElementRef<HTMLDialogElement>>('confirmDialog');

  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly summary = signal<ProjectCleaningSummary | null>(null);
  readonly suggestions = signal<CleaningSuggestion[]>([]);
  readonly history = signal<CleaningHistoryEntry[]>([]);
  readonly scope = signal<CleaningScope>('project');
  readonly railMode = signal<RailMode>('type');
  readonly issueType = signal('all');
  readonly columnFilter = signal('all');
  readonly search = signal('');
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly strategyOverrides = signal<Record<string, string>>({});
  readonly customValues = signal<Record<string, string>>({});
  readonly duplicateColumns = signal<Record<string, string>>({});
  readonly preview = signal<CleaningPreviewResponse | null>(null);
  readonly previewOperations = signal<CleaningOperationRequest[]>([]);
  readonly previewLoading = signal(false);
  readonly applyLoading = signal(false);
  readonly destructiveConfirmed = signal(false);
  readonly fixAllIds = signal<Set<string>>(new Set());
  readonly feedback = signal<FeedbackMessage | null>(null);
  readonly selectedHistoryId = signal<number | null>(null);
  readonly versions = signal<Record<number, DatasetVersion[]>>({});
  readonly confirmAction = signal<ConfirmAction | null>(null);
  readonly reanalyzing = signal(false);
  readonly reanalysisCurrent = signal(0);
  readonly reanalysisTotal = signal(0);
  readonly reanalysisDataset = signal('');

  projectId = 0;

  readonly issueCategories = [
    'Missing Values',
    'Data Type Issues',
    'Invalid Dates',
    'Extra Spaces',
    'Inconsistent Case',
    'Outliers',
    'Duplicates',
    'Other Issues',
  ];

  readonly filteredSuggestions = computed(() => {
    const scope = this.scope();
    const type = this.issueType();
    const column = this.columnFilter();
    const query = this.search().trim().toLocaleLowerCase();
    return this.suggestions().filter((suggestion) => {
      if (scope !== 'project' && suggestion.datasetId !== scope) return false;
      if (type !== 'all' && suggestion.issueType !== type) return false;
      if (column !== 'all' && suggestion.column !== column) return false;
      if (query && !`${suggestion.issueType} ${suggestion.datasetName} ${suggestion.column ?? ''} ${suggestion.description}`.toLocaleLowerCase().includes(query)) return false;
      return true;
    });
  });

  readonly columns = computed(() => Array.from(new Set(this.suggestions().map((suggestion) => suggestion.column).filter((value): value is string => Boolean(value)))).sort());
  readonly selectedSuggestions = computed(() => this.suggestions().filter((suggestion) => this.selectedIds().has(suggestion.id)));
  readonly safeSuggestions = computed(() => this.filteredSuggestions().filter((suggestion) => suggestion.recommendedStrategy.isSafeRecommended));
  readonly selectedDataset = computed(() => {
    const scope = this.scope();
    return typeof scope === 'number' ? this.summary()?.datasets.find((dataset) => dataset.datasetId === scope) ?? null : null;
  });
  readonly scopeLabel = computed(() => this.scope() === 'project' ? 'All Project Data' : this.selectedDataset()?.datasetName ?? 'Selected Dataset');
  readonly activeVersion = computed(() => {
    const dataset = this.selectedDataset();
    return dataset ? this.versions()[dataset.datasetId]?.find((version) => version.isActive) ?? null : null;
  });
  readonly latestUndoable = computed(() => this.history().find((entry) => entry.canUndo) ?? null);
  readonly previewColumns = computed(() => {
    const rows = this.preview()?.datasets.flatMap((dataset) => dataset.rows) ?? [];
    return Array.from(new Set(rows.flatMap((row) => [...Object.keys(row.before ?? {}), ...Object.keys(row.after ?? {})])));
  });

  ngOnInit(): void {
    this.projectId = Number(this.route.snapshot.paramMap.get('projectId'));
    if (!Number.isFinite(this.projectId) || this.projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }
    const requestedDataset = Number(this.route.snapshot.queryParamMap.get('datasetId'));
    const requestedIssueType = this.route.snapshot.queryParamMap.get('issueType');
    const requestedColumn = this.route.snapshot.queryParamMap.get('column');
    if (Number.isFinite(requestedDataset) && requestedDataset > 0) this.scope.set(requestedDataset);
    if (requestedIssueType) this.issueType.set(requestedIssueType);
    if (requestedColumn) this.columnFilter.set(requestedColumn);
    this.loadWorkspace();
  }

  selectProjectScope(): void {
    this.scope.set('project');
    this.workflow.clearDataset();
    this.columnFilter.set('all');
    this.updateUrl();
  }

  selectDataset(dataset: DatasetCleaningSummary): void {
    this.scope.set(dataset.datasetId);
    this.workflow.setDatasetId(dataset.datasetId, dataset.datasetName, dataset.requiresReanalysis ? 'Cleaned - Analysis Required' : 'Analyzed');
    this.columnFilter.set('all');
    this.updateUrl();
    this.loadVersions(dataset.datasetId);
  }

  setRailMode(mode: RailMode): void { this.railMode.set(mode); }
  updateSearch(value: string): void { this.search.set(value); }
  updateIssueType(value: string): void { this.issueType.set(value); this.updateUrl(); }
  updateColumnFilter(value: string): void { this.columnFilter.set(value); this.updateUrl(); }

  issueCount(type: string): number {
    return this.suggestions().filter((suggestion) => suggestion.issueType === type && (this.scope() === 'project' || suggestion.datasetId === this.scope())).length;
  }

  datasetIssueCount(datasetId: number): number {
    return this.suggestions().filter((suggestion) => suggestion.datasetId === datasetId).length;
  }

  toggleSuggestion(suggestion: CleaningSuggestion): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      next.has(suggestion.id) ? next.delete(suggestion.id) : next.add(suggestion.id);
      return next;
    });
  }

  toggleAllVisible(): void {
    const visible = this.filteredSuggestions();
    const allSelected = visible.length > 0 && visible.every((suggestion) => this.selectedIds().has(suggestion.id));
    this.selectedIds.update((current) => {
      const next = new Set(current);
      for (const suggestion of visible) allSelected ? next.delete(suggestion.id) : next.add(suggestion.id);
      return next;
    });
  }

  updateStrategy(suggestion: CleaningSuggestion, key: string): void {
    this.strategyOverrides.update((current) => ({ ...current, [suggestion.id]: key }));
  }

  selectedStrategy(suggestion: CleaningSuggestion): CleaningStrategy {
    const key = this.strategyOverrides()[suggestion.id] ?? suggestion.recommendedStrategy.key;
    return suggestion.availableStrategies.find((strategy) => strategy.key === key) ?? suggestion.recommendedStrategy;
  }

  selectedStrategyNeedsCustomValue(suggestion: CleaningSuggestion): boolean {
    const parameters = this.selectedStrategy(suggestion).parameters;
    return parameters['strategy'] === 'custom' || parameters['invalidAction'] === 'replace';
  }

  updateCustomValue(suggestionId: string, value: string): void {
    this.customValues.update((current) => ({ ...current, [suggestionId]: value }));
  }

  updateDuplicateColumns(suggestionId: string, value: string): void {
    this.duplicateColumns.update((current) => ({ ...current, [suggestionId]: value }));
  }

  async previewSuggestion(suggestion: CleaningSuggestion): Promise<void> {
    await this.previewOperationsRequest([this.buildOperation(suggestion)]);
  }

  async previewSelected(): Promise<void> {
    if (this.selectedSuggestions().length === 0) return;
    await this.previewOperationsRequest(this.selectedSuggestions().map((suggestion) => this.buildOperation(suggestion)));
  }

  openFixAllReview(): void {
    const safe = this.safeSuggestions();
    if (safe.length === 0) {
      this.feedback.set({ kind: 'warning', title: 'No safe automatic fixes', message: 'The current issues require individual review or destructive confirmation.' });
      return;
    }
    this.fixAllIds.set(new Set(safe.map((suggestion) => suggestion.id)));
    this.fixAllDialog()?.nativeElement.showModal();
  }

  toggleFixAllSuggestion(id: string): void {
    this.fixAllIds.update((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  closeFixAllDialog(): void { this.fixAllDialog()?.nativeElement.close(); }

  async previewFixAll(): Promise<void> {
    const suggestions = this.safeSuggestions().filter((suggestion) => this.fixAllIds().has(suggestion.id));
    if (suggestions.length === 0) return;
    this.closeFixAllDialog();
    await this.previewOperationsRequest(suggestions.map((suggestion) => this.buildOperation(suggestion)));
  }

  closePreview(force = false): void {
    if (this.applyLoading() && !force) return;
    this.previewDialog()?.nativeElement.close();
    this.preview.set(null);
    this.previewOperations.set([]);
    this.destructiveConfirmed.set(false);
  }

  async applyPreview(): Promise<void> {
    const preview = this.preview();
    if (!preview || (preview.destructive && !this.destructiveConfirmed()) || this.applyLoading()) return;
    this.applyLoading.set(true);
    try {
      const result = await firstValueFrom(this.api.applyCleaning(this.projectId, {
        batchName: this.previewOperations().length > 1 ? `Apply ${this.previewOperations().length} reviewed fixes` : 'Apply reviewed cleaning fix',
        confirmDestructive: this.destructiveConfirmed(),
        operations: this.previewOperations(),
      }));
      this.closePreview(true);
      this.handleApplyResult(result);
      await this.reloadWorkspace();
      this.selectedIds.set(new Set());
    } catch (error: unknown) {
      this.feedback.set({ kind: 'error', title: 'Apply failed', message: this.errorMessage(error, 'The reviewed changes could not be applied.') });
    } finally {
      this.applyLoading.set(false);
    }
  }

  showHistoryDetails(entry: CleaningHistoryEntry): void {
    this.selectedHistoryId.update((current) => current === entry.batchId ? null : entry.batchId);
  }

  requestUndo(): void {
    if (!this.latestUndoable()) return;
    this.confirmAction.set({ kind: 'undo' });
    this.confirmDialog()?.nativeElement.showModal();
  }

  requestRestore(datasetId: number, version: DatasetVersion): void {
    if (version.isActive) return;
    this.confirmAction.set({ kind: 'restore', datasetId, version });
    this.confirmDialog()?.nativeElement.showModal();
  }

  closeConfirmDialog(): void {
    if (this.applyLoading()) return;
    this.confirmDialog()?.nativeElement.close();
    this.confirmAction.set(null);
  }

  async confirmUndoOrRestore(): Promise<void> {
    const action = this.confirmAction();
    if (!action || this.applyLoading()) return;
    this.applyLoading.set(true);
    try {
      const result = action.kind === 'undo'
        ? await firstValueFrom(this.api.undoLatestCleaning(this.projectId))
        : await firstValueFrom(this.api.restoreDatasetVersion(this.projectId, action.datasetId, action.version.id));
      this.closeConfirmDialog();
      this.handleApplyResult(result);
      await this.reloadWorkspace();
    } catch (error: unknown) {
      this.feedback.set({ kind: 'error', title: action.kind === 'undo' ? 'Undo failed' : 'Restore failed', message: this.errorMessage(error, 'The version operation could not be completed.') });
    } finally {
      this.applyLoading.set(false);
    }
  }

  async rerunAnalysis(): Promise<void> {
    const datasets = this.summary()?.datasets ?? [];
    if (datasets.length === 0 || this.reanalyzing()) return;
    this.reanalyzing.set(true);
    this.reanalysisCurrent.set(0);
    this.reanalysisTotal.set(datasets.length);
    const failures: string[] = [];
    for (let index = 0; index < datasets.length; index++) {
      const dataset = datasets[index];
      this.reanalysisCurrent.set(index + 1);
      this.reanalysisDataset.set(dataset.datasetName);
      try {
        await firstValueFrom(this.api.analyzeDataset(dataset.datasetId, { analysisType: 'profile' }));
      } catch {
        failures.push(dataset.datasetName);
      }
    }
    this.reanalyzing.set(false);
    this.reanalysisDataset.set('');
    this.feedback.set(failures.length === 0
      ? { kind: 'success', title: 'Re-analysis completed', message: 'Every active cleaned dataset version has been analyzed.' }
      : { kind: 'warning', title: 'Re-analysis partially completed', message: `Failed datasets: ${failures.join(', ')}. Retry will re-run the project analysis.` });
    await this.reloadWorkspace();
  }

  async confirmQuality(): Promise<void> {
    if (!this.summary()?.canConfirmQuality || this.applyLoading()) return;
    this.applyLoading.set(true);
    try {
      await firstValueFrom(this.api.confirmCleaningQuality(this.projectId));
      this.feedback.set({ kind: 'success', title: 'Data quality confirmed', message: 'The active analyzed versions are now approved for Schema.' });
      await this.reloadWorkspace();
    } catch (error: unknown) {
      this.feedback.set({ kind: 'error', title: 'Confirmation failed', message: this.errorMessage(error, 'Data quality could not be confirmed.') });
    } finally {
      this.applyLoading.set(false);
    }
  }

  continueToSchema(): void {
    if (!this.summary()?.schemaReady) return;
    void this.router.navigate(['/projects', this.projectId, 'schema-designer'], { queryParams: { returnTo: 'data-cleaning' } });
  }

  versionLabel(dataset: DatasetCleaningSummary): string {
    return dataset.isRawOriginal ? 'Raw v1' : `Cleaned v${dataset.versionNumber}`;
  }

  datasetVersions(datasetId: number): DatasetVersion[] {
    return this.versions()[datasetId] || [];
  }

  statusClass(status: string): string {
    if (status === 'Succeeded') return 'status-success';
    if (status === 'PartiallySucceeded') return 'status-warning';
    if (status === 'Failed') return 'status-danger';
    return 'status-neutral';
  }

  formatValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'NULL';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private loadWorkspace(): void {
    this.loading.set(true);
    this.loadError.set('');
    forkJoin({
      summary: this.api.getProjectCleaningSummary(this.projectId),
      suggestions: this.api.getCleaningSuggestions(this.projectId),
      history: this.api.getCleaningHistory(this.projectId),
    }).subscribe({
      next: ({ summary, suggestions, history }) => {
        this.summary.set(summary);
        this.suggestions.set(suggestions);
        this.history.set(history.entries);
        this.workflow.setProjectId(this.projectId, summary.projectName);
        if (typeof this.scope() === 'number' && !summary.datasets.some((dataset) => dataset.datasetId === this.scope())) this.scope.set('project');
        if (typeof this.scope() === 'number') this.loadVersions(this.scope() as number);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loadError.set(this.errorMessage(error, 'Unable to load the Data Cleaning workspace.'));
        this.loading.set(false);
      },
    });
  }

  private async reloadWorkspace(): Promise<void> {
    const [summary, suggestions, history] = await Promise.all([
      firstValueFrom(this.api.getProjectCleaningSummary(this.projectId)),
      firstValueFrom(this.api.getCleaningSuggestions(this.projectId)),
      firstValueFrom(this.api.getCleaningHistory(this.projectId)),
    ]);
    this.summary.set(summary);
    this.suggestions.set(suggestions);
    this.history.set(history.entries);
    if (typeof this.scope() === 'number') this.loadVersions(this.scope() as number);
  }

  private loadVersions(datasetId: number): void {
    this.api.getDatasetVersions(this.projectId, datasetId).subscribe({
      next: (versions) => this.versions.update((current) => ({ ...current, [datasetId]: versions })),
      error: () => this.versions.update((current) => ({ ...current, [datasetId]: [] })),
    });
  }

  private async previewOperationsRequest(operations: CleaningOperationRequest[]): Promise<void> {
    if (operations.length === 0 || this.previewLoading()) return;
    this.previewLoading.set(true);
    this.feedback.set(null);
    try {
      const preview = await firstValueFrom(this.api.previewCleaning(this.projectId, { operations }));
      this.preview.set(preview);
      this.previewOperations.set(operations);
      this.destructiveConfirmed.set(false);
      this.previewDialog()?.nativeElement.showModal();
    } catch (error: unknown) {
      this.feedback.set({ kind: 'error', title: 'Preview failed', message: this.errorMessage(error, 'The selected changes could not be previewed.') });
    } finally {
      this.previewLoading.set(false);
    }
  }

  private buildOperation(suggestion: CleaningSuggestion): CleaningOperationRequest {
    const strategy = this.selectedStrategy(suggestion);
    const parameters = { ...strategy.parameters };
    if (parameters['strategy'] === 'custom' || parameters['invalidAction'] === 'replace') parameters['value'] = this.customValues()[suggestion.id] ?? '';
    if (strategy.operationType === 'remove_duplicates') {
      const value = this.duplicateColumns()[suggestion.id];
      if (value?.trim()) parameters['columns'] = value.split(',').map((column) => column.trim()).filter(Boolean);
    }
    return {
      operationId: suggestion.id,
      suggestionId: suggestion.id,
      datasetId: suggestion.datasetId,
      operationType: strategy.operationType,
      column: suggestion.column,
      parameters,
    };
  }

  private handleApplyResult(result: CleaningApplyResponse): void {
    const failures = result.datasets.filter((dataset) => !dataset.success);
    this.feedback.set(failures.length === 0
      ? { kind: 'success', title: 'Cleaning batch applied', message: `${result.datasets.length} dataset version${result.datasets.length === 1 ? '' : 's'} created. Re-run Analysis before confirming quality.` }
      : { kind: 'warning', title: 'Cleaning partially applied', message: `${result.datasets.length - failures.length} succeeded; ${failures.length} failed: ${failures.map((failure) => failure.datasetName).join(', ')}.` });
  }

  private updateUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        datasetId: typeof this.scope() === 'number' ? this.scope() : null,
        issueType: this.issueType() !== 'all' ? this.issueType() : null,
        column: this.columnFilter() !== 'all' ? this.columnFilter() : null,
      },
    });
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const detail = error.error?.detail ?? error.error?.message;
      if (typeof detail === 'string' && detail.trim()) return detail;
    }
    return fallback;
  }
}
