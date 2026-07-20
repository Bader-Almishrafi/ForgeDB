import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
import {
  CleaningApplyResponse,
  CleaningHistoryEntry,
  CleaningOperationRequest,
  CleaningPreviewResponse,
  CleaningStrategy,
  CleaningSuggestion,
  DatasetAnalysisResponse,
  DatasetCleaningSummary,
  DatasetVersion,
  ProjectCleaningSummary,
  ProjectWorkflowDataset,
} from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { routeParameter } from '../../services/route-context';
import { CleaningIssueCardComponent } from './cleaning-issue-card.component';
import { CleaningPreviewDialogComponent } from './cleaning-preview-dialog.component';

type CleaningScope = 'project' | number;
type ConfirmAction = { kind: 'undo' } | { kind: 'restore'; datasetId: number; version: DatasetVersion };

interface FeedbackMessage {
  kind: 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

interface AnalysisTarget {
  datasetId: number;
  datasetName: string;
  expectedVersionId: number | null;
}

interface AnalysisFailure {
  datasetId: number;
  datasetName: string;
  message: string;
  conflict: boolean;
}

@Component({
  selector: 'app-data-cleaning',
  standalone: true,
  imports: [CleaningIssueCardComponent, CleaningPreviewDialogComponent, DatePipe, DecimalPipe, FormsModule, RouterLink],
  templateUrl: './data-cleaning.component.html',
  styleUrl: './data-cleaning.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataCleaningComponent implements OnInit {
  private readonly api = inject(ForgeApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly workflowContext = inject(ProjectWorkflowContextService);
  private queryDatasetValue: string | null = null;
  private loadVersion = 0;

  readonly previewDialog = viewChild(CleaningPreviewDialogComponent);
  readonly confirmDialog = viewChild<ElementRef<HTMLDialogElement>>('confirmDialog');

  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly summary = signal<ProjectCleaningSummary | null>(null);
  readonly suggestions = signal<CleaningSuggestion[]>([]);
  readonly history = signal<CleaningHistoryEntry[]>([]);
  readonly versions = signal<Record<number, DatasetVersion[]>>({});
  readonly scope = signal<CleaningScope>('project');
  readonly scopeNotice = signal('');
  readonly search = signal('');
  readonly issueType = signal('all');
  readonly columnFilter = signal('all');
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly strategyOverrides = signal<Record<string, string>>({});
  readonly customValues = signal<Record<string, string>>({});
  readonly duplicateColumns = signal<Record<string, string>>({});
  readonly preview = signal<CleaningPreviewResponse | null>(null);
  readonly previewOperations = signal<CleaningOperationRequest[]>([]);
  readonly previewLoading = signal(false);
  readonly applyLoading = signal(false);
  readonly destructiveConfirmed = signal(false);
  readonly feedback = signal<FeedbackMessage | null>(null);
  readonly confirmAction = signal<ConfirmAction | null>(null);
  readonly reanalyzing = signal(false);
  readonly reanalysisCurrent = signal(0);
  readonly reanalysisTotal = signal(0);
  readonly reanalysisDataset = signal('');
  readonly analysisFailures = signal<AnalysisFailure[]>([]);

  projectId = 0;

  readonly projectName = computed(() => this.workflowContext.workflow()?.projectName ?? this.summary()?.projectName ?? 'Project');
  readonly datasets = computed(() => this.summary()?.datasets ?? []);
  readonly selectedDataset = computed(() => {
    const scope = this.scope();
    return typeof scope === 'number' ? this.datasets().find((dataset) => dataset.datasetId === scope) ?? null : null;
  });
  readonly scopeSuggestions = computed(() => {
    const scope = this.scope();
    return scope === 'project' ? this.suggestions() : this.suggestions().filter((suggestion) => suggestion.datasetId === scope);
  });
  readonly issueTypes = computed(() => [...new Set(this.scopeSuggestions().map((suggestion) => suggestion.issueType))].sort());
  readonly columns = computed(() => [...new Set(this.scopeSuggestions()
    .map((suggestion) => suggestion.column)
    .filter((column): column is string => !!column))].sort());
  readonly filteredSuggestions = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return this.scopeSuggestions().filter((suggestion) => {
      if (this.issueType() !== 'all' && suggestion.issueType !== this.issueType()) return false;
      if (this.columnFilter() !== 'all' && suggestion.column !== this.columnFilter()) return false;
      return !query || `${suggestion.datasetName} ${suggestion.issueType} ${suggestion.column ?? ''} ${suggestion.description}`.toLocaleLowerCase().includes(query);
    });
  });
  readonly selectedSuggestions = computed(() => this.scopeSuggestions().filter((suggestion) => this.selectedIds().has(suggestion.id)));
  readonly safeRecommendations = computed(() => this.scopeSuggestions().filter((suggestion) =>
    suggestion.recommendedStrategy.isSafeRecommended && !suggestion.recommendedStrategy.isDestructive));
  readonly datasetsRequiringAnalysis = computed(() => {
    const workflow = this.workflowContext.workflow();
    return (workflow?.datasets ?? []).filter((dataset) => dataset.requiresAnalysis || !dataset.hasCurrentAnalysis);
  });
  readonly cleaningReady = computed(() => this.datasets().length > 0
    && this.datasetsRequiringAnalysis().length === 0
    && this.workflowContext.workflow()?.canClean === true);
  readonly canConfirmQuality = computed(() => this.cleaningReady()
    && this.summary()?.canConfirmQuality === true
    && this.summary()?.qualityConfirmed !== true);
  readonly canContinueToSchema = computed(() => this.workflowContext.workflow()?.canBuildSchema === true);
  readonly schemaBlockingReason = computed(() => this.workflowContext.workflow()?.blockingReasons[0]
    ?? 'Confirm data quality for the current active versions before continuing.');
  readonly latestUndoable = computed(() => this.history().find((entry) => entry.canUndo) ?? null);
  readonly analysisFailureNames = computed(() => this.analysisFailures().map((failure) => failure.datasetName).join(', '));
  readonly allVisibleSelected = computed(() => this.filteredSuggestions().length > 0
    && this.filteredSuggestions().every((suggestion) => this.selectedIds().has(suggestion.id)));

  ngOnInit(): void {
    this.projectId = routeParameter(this.route, 'projectId') ?? 0;
    if (this.projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.queryDatasetValue = params.get('datasetId');
      if (params.has('issueType') || params.has('column') || params.has('search')) this.removeLegacyFilterParams();
      if (this.summary()) this.applyRouteScope();
    });
    this.loadWorkspace();
  }

  changeScope(value: CleaningScope): void {
    if (value === 'project') {
      this.scope.set('project');
      this.workflowContext.setDatasetFromQuery(null);
      this.scopeNotice.set('');
      this.resetIssueSelection();
      this.updateDatasetQuery(null, false);
      return;
    }
    const datasetId = Number(value);
    if (!this.datasets().some((dataset) => dataset.datasetId === datasetId)) return;
    this.scope.set(datasetId);
    this.workflowContext.setDatasetFromQuery(datasetId);
    this.scopeNotice.set('');
    this.resetIssueSelection();
    this.updateDatasetQuery(datasetId, false);
    void this.loadVersions(datasetId);
  }

  openDataset(datasetId: number): void {
    this.changeScope(datasetId);
  }

  updateSearch(value: string): void { this.search.set(value); }
  updateIssueType(value: string): void { this.issueType.set(value); }
  updateColumnFilter(value: string): void { this.columnFilter.set(value); }

  datasetIssueCount(datasetId: number): number {
    return this.suggestions().filter((suggestion) => suggestion.datasetId === datasetId).length;
  }

  datasetWorkflow(datasetId: number): ProjectWorkflowDataset | null {
    return this.workflowContext.workflow()?.datasets.find((dataset) => dataset.datasetId === datasetId) ?? null;
  }

  datasetStatus(dataset: DatasetCleaningSummary): string {
    const workflowDataset = this.datasetWorkflow(dataset.datasetId);
    if (workflowDataset?.isQualityConfirmed) return 'Quality confirmed';
    if (!workflowDataset?.hasCurrentAnalysis || workflowDataset.requiresAnalysis) return 'Re-analysis required';
    return 'Analyzed';
  }

  datasetVersionKind(dataset: DatasetCleaningSummary): string {
    if (dataset.isRawOriginal) return 'Imported';
    const batch = this.history().find((entry) => entry.operations.some((operation) => operation.resultVersionId === dataset.activeVersionId));
    return batch?.isRestore || batch?.isUndo ? 'Restored' : 'Cleaned';
  }

  versionKind(version: DatasetVersion): string {
    if (version.isRawOriginal) return 'Imported';
    return /restore|undo/i.test(version.operationSummary) ? 'Restored' : 'Cleaned';
  }

  datasetVersions(datasetId: number): DatasetVersion[] {
    return this.versions()[datasetId] ?? [];
  }

  toggleSuggestion(suggestion: CleaningSuggestion): void {
    this.selectedIds.update((selected) => {
      const next = new Set(selected);
      next.has(suggestion.id) ? next.delete(suggestion.id) : next.add(suggestion.id);
      return next;
    });
  }

  toggleAllVisible(): void {
    const select = !this.allVisibleSelected();
    this.selectedIds.update((selected) => {
      const next = new Set(selected);
      for (const suggestion of this.filteredSuggestions()) select ? next.add(suggestion.id) : next.delete(suggestion.id);
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
    if (!this.selectedSuggestions().length) return;
    await this.previewOperationsRequest(this.selectedSuggestions().map((suggestion) => this.buildOperation(suggestion)));
  }

  async previewRecommendedFixes(): Promise<void> {
    const safe = this.safeRecommendations();
    if (!safe.length) {
      this.feedback.set({
        kind: 'warning',
        title: 'No safe recommendations',
        message: 'The current issues require individual review or a destructive-operation confirmation.',
      });
      return;
    }
    this.selectedIds.set(new Set(safe.map((suggestion) => suggestion.id)));
    await this.previewOperationsRequest(safe.map((suggestion) => this.buildOperation(suggestion)));
  }

  async removePreviewOperation(operationId: string | null | undefined): Promise<void> {
    if (!operationId || this.previewLoading() || this.applyLoading()) return;
    const remaining = this.previewOperations().filter((operation) => operation.operationId !== operationId);
    if (!remaining.length) {
      this.closePreview();
      return;
    }
    await this.previewOperationsRequest(remaining);
  }

  closePreview(force = false): void {
    if (this.applyLoading() && !force) return;
    this.previewDialog()?.close();
    this.invalidatePreview();
  }

  async applyPreview(): Promise<void> {
    const preview = this.preview();
    if (!preview || this.applyLoading() || (preview.destructive && !this.destructiveConfirmed())) return;
    if (!this.previewMatchesExpectedVersions(preview, this.previewOperations())) {
      await this.recoverFromStaleVersion();
      return;
    }

    this.applyLoading.set(true);
    try {
      const result = await firstValueFrom(this.api.applyCleaning(this.projectId, {
        batchName: this.previewOperations().length === 1
          ? 'Apply reviewed cleaning fix'
          : `Apply ${this.previewOperations().length} reviewed fixes`,
        confirmDestructive: this.destructiveConfirmed(),
        operations: this.previewOperations(),
      }));
      this.closePreview(true);
      this.resetIssueSelection();
      await this.processVersionResult(result, 'Cleaning changes applied');
    } catch (error: unknown) {
      if (this.isActiveVersionConflict(error)) await this.recoverFromStaleVersion();
      else this.feedback.set({ kind: 'error', title: 'Apply failed', message: this.errorMessage(error, 'The reviewed changes could not be applied.') });
    } finally {
      this.applyLoading.set(false);
    }
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
    this.dismissConfirmDialog();
  }

  async confirmUndoOrRestore(): Promise<void> {
    const action = this.confirmAction();
    if (!action || this.applyLoading()) return;
    this.applyLoading.set(true);
    try {
      const result = action.kind === 'undo'
        ? await firstValueFrom(this.api.undoLatestCleaning(this.projectId))
        : await firstValueFrom(this.api.restoreDatasetVersion(this.projectId, action.datasetId, action.version.id));
      this.dismissConfirmDialog();
      await this.processVersionResult(result, action.kind === 'undo' ? 'Undo created a new active version' : 'Restore created a new active version');
    } catch (error: unknown) {
      if (this.isActiveVersionConflict(error)) await this.recoverFromStaleVersion();
      else this.feedback.set({
        kind: 'error',
        title: action.kind === 'undo' ? 'Undo failed' : 'Restore failed',
        message: this.errorMessage(error, 'The version operation could not be completed.'),
      });
    } finally {
      this.applyLoading.set(false);
    }
  }

  async retryAnalysis(): Promise<void> {
    if (this.reanalyzing()) return;
    const failedIds = new Set(this.analysisFailures().map((failure) => failure.datasetId));
    const targets = (this.workflowContext.workflow()?.datasets ?? [])
      .filter((dataset) => failedIds.has(dataset.datasetId) && dataset.requiresAnalysis)
      .map((dataset): AnalysisTarget => ({
        datasetId: dataset.datasetId,
        datasetName: dataset.datasetName,
        expectedVersionId: dataset.activeVersionId ?? null,
      }));
    if (!targets.length) {
      this.analysisFailures.set([]);
      return;
    }
    const failures = await this.analyzeTargets(targets);
    this.feedback.set(failures.length
      ? { kind: 'warning', title: 'Re-analysis incomplete', message: `Still requiring analysis: ${failures.map((failure) => failure.datasetName).join(', ')}.` }
      : { kind: 'success', title: 'Re-analysis completed', message: 'All changed active versions now have current saved analysis.' });
  }

  async confirmQuality(): Promise<void> {
    if (!this.canConfirmQuality() || this.applyLoading()) return;
    this.applyLoading.set(true);
    try {
      await firstValueFrom(this.api.confirmCleaningQuality(this.projectId));
      await this.reloadWorkspace(true);
      this.feedback.set({ kind: 'success', title: 'Quality confirmed', message: 'Data quality is confirmed for every current active dataset version.' });
    } catch (error: unknown) {
      this.feedback.set({ kind: 'error', title: 'Confirmation failed', message: this.errorMessage(error, 'Data quality could not be confirmed.') });
    } finally {
      this.applyLoading.set(false);
    }
  }

  continueToSchema(): void {
    if (!this.canContinueToSchema()) return;
    const datasetId = this.selectedDataset()?.datasetId;
    void this.router.navigate(['/projects', this.projectId, 'schema'], { queryParams: datasetId ? { datasetId } : {} });
  }

  navigationQuery(): { datasetId: number } | Record<string, never> {
    const datasetId = this.selectedDataset()?.datasetId;
    return datasetId ? { datasetId } : {};
  }

  affectedDatasetNames(entry: CleaningHistoryEntry): string {
    return [...new Set(entry.operations.map((operation) => operation.datasetName))].join(', ') || 'None';
  }

  loadWorkspace(): void {
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.loadError.set('');
    forkJoin({
      summary: this.api.getProjectCleaningSummary(this.projectId),
      suggestions: this.api.getCleaningSuggestions(this.projectId),
      history: this.api.getCleaningHistory(this.projectId),
      workflow: this.workflowContext.load(this.projectId),
    }).subscribe({
      next: ({ summary, suggestions, history, workflow }) => {
        if (version !== this.loadVersion) return;
        if (!workflow) {
          this.loadError.set(this.workflowContext.error()?.message ?? 'Unable to load the project workflow.');
          this.loading.set(false);
          return;
        }
        this.setWorkspaceData(summary, suggestions, history.entries);
        this.applyRouteScope();
        this.loading.set(false);
      },
      error: (error: unknown) => {
        if (version !== this.loadVersion) return;
        this.loadError.set(this.errorMessage(error, 'Unable to load the cleaning workspace.'));
        this.loading.set(false);
      },
    });
  }

  private async reloadWorkspace(forceWorkflow: boolean): Promise<void> {
    const { summary, suggestions, history, workflow } = await firstValueFrom(forkJoin({
      summary: this.api.getProjectCleaningSummary(this.projectId),
      suggestions: this.api.getCleaningSuggestions(this.projectId),
      history: this.api.getCleaningHistory(this.projectId),
      workflow: this.workflowContext.load(this.projectId, forceWorkflow),
    }));
    if (!workflow) throw new Error('Project workflow could not be refreshed.');
    this.setWorkspaceData(summary, suggestions, history.entries);
    this.applyRouteScope();
    const datasetId = this.selectedDataset()?.datasetId;
    if (datasetId) await this.loadVersions(datasetId);
  }

  private setWorkspaceData(summary: ProjectCleaningSummary, suggestions: CleaningSuggestion[], history: CleaningHistoryEntry[]): void {
    this.summary.set(summary);
    this.suggestions.set(suggestions);
    this.history.set(history);
  }

  private applyRouteScope(): void {
    if (this.queryDatasetValue === null) {
      this.scope.set('project');
      this.workflowContext.setDatasetFromQuery(null);
      return;
    }
    const datasetId = Number(this.queryDatasetValue);
    if (Number.isInteger(datasetId) && datasetId > 0 && this.datasets().some((dataset) => dataset.datasetId === datasetId)) {
      this.scope.set(datasetId);
      this.workflowContext.setDatasetFromQuery(datasetId);
      void this.loadVersions(datasetId);
      return;
    }
    this.scope.set('project');
    this.workflowContext.setDatasetFromQuery(null);
    this.scopeNotice.set('The selected dataset is not in this project. Showing all datasets.');
    this.updateDatasetQuery(null, true);
  }

  private async loadVersions(datasetId: number): Promise<void> {
    try {
      const versions = await firstValueFrom(this.api.getDatasetVersions(this.projectId, datasetId));
      this.versions.update((current) => ({ ...current, [datasetId]: versions }));
    } catch {
      this.versions.update((current) => ({ ...current, [datasetId]: [] }));
    }
  }

  private async previewOperationsRequest(operations: CleaningOperationRequest[]): Promise<void> {
    if (!operations.length || this.previewLoading() || this.applyLoading() || !this.cleaningReady()) return;
    this.previewLoading.set(true);
    this.feedback.set(null);
    try {
      const preview = await firstValueFrom(this.api.previewCleaning(this.projectId, { operations }));
      if (!this.previewMatchesExpectedVersions(preview, operations)) {
        await this.recoverFromStaleVersion();
        return;
      }
      this.preview.set(preview);
      this.previewOperations.set(operations);
      this.destructiveConfirmed.set(false);
      this.previewDialog()?.open();
    } catch (error: unknown) {
      if (this.isActiveVersionConflict(error)) await this.recoverFromStaleVersion();
      else this.feedback.set({ kind: 'error', title: 'Preview failed', message: this.errorMessage(error, 'The selected changes could not be previewed.') });
    } finally {
      this.previewLoading.set(false);
    }
  }

  private buildOperation(suggestion: CleaningSuggestion): CleaningOperationRequest {
    const strategy = this.selectedStrategy(suggestion);
    const parameters = { ...strategy.parameters };
    if (parameters['strategy'] === 'custom' || parameters['invalidAction'] === 'replace') {
      parameters['value'] = this.customValues()[suggestion.id] ?? '';
    }
    if (strategy.operationType === 'remove_duplicates') {
      const columns = this.duplicateColumns()[suggestion.id]?.split(',').map((column) => column.trim()).filter(Boolean);
      if (columns?.length) parameters['columns'] = columns;
    }
    return {
      operationId: suggestion.id,
      suggestionId: suggestion.id,
      datasetId: suggestion.datasetId,
      expectedSourceVersionId: suggestion.versionId,
      operationType: strategy.operationType,
      column: suggestion.column,
      parameters,
    };
  }

  private previewMatchesExpectedVersions(preview: CleaningPreviewResponse, operations: CleaningOperationRequest[]): boolean {
    return preview.datasets.every((dataset) => operations
      .filter((operation) => operation.datasetId === dataset.datasetId)
      .every((operation) => operation.expectedSourceVersionId === dataset.sourceVersionId));
  }

  private async processVersionResult(result: CleaningApplyResponse, successTitle: string): Promise<void> {
    const successful = result.datasets.filter((dataset) => dataset.success && dataset.versionId != null);
    const cleaningFailures = result.datasets.filter((dataset) => !dataset.success);
    try {
      await this.reloadWorkspace(true);
    } catch (error: unknown) {
      const failures = successful.map((dataset): AnalysisFailure => ({
        datasetId: dataset.datasetId,
        datasetName: dataset.datasetName,
        message: 'The new active version was saved, but the workflow could not be refreshed.',
        conflict: false,
      }));
      this.analysisFailures.set(failures);
      this.feedback.set({
        kind: 'warning',
        title: 'Cleaning saved; refresh required',
        message: this.errorMessage(error, 'New active versions were saved, but the workspace could not be refreshed.'),
      });
      return;
    }

    const targets = successful.map((dataset): AnalysisTarget => ({
      datasetId: dataset.datasetId,
      datasetName: dataset.datasetName,
      expectedVersionId: dataset.versionId ?? null,
    }));
    const analysisFailures = await this.analyzeTargets(targets);

    if (analysisFailures.length) {
      this.feedback.set({
        kind: 'warning',
        title: 'Cleaning saved; re-analysis incomplete',
        message: `New active versions remain preserved. Analysis failed for: ${analysisFailures.map((failure) => failure.datasetName).join(', ')}.`,
      });
    } else if (cleaningFailures.length) {
      this.feedback.set({
        kind: 'warning',
        title: 'Cleaning partially applied',
        message: `${successful.length} succeeded; failed datasets: ${cleaningFailures.map((failure) => failure.datasetName).join(', ')}.`,
      });
    } else {
      this.feedback.set({ kind: 'success', title: successTitle, message: 'The new active versions were analyzed successfully. Review quality before continuing.' });
    }
  }

  private async analyzeTargets(targets: AnalysisTarget[]): Promise<AnalysisFailure[]> {
    const unique = [...new Map(targets.map((target) => [target.datasetId, target])).values()];
    if (!unique.length) {
      this.analysisFailures.set([]);
      return [];
    }

    this.reanalyzing.set(true);
    this.reanalysisCurrent.set(0);
    this.reanalysisTotal.set(unique.length);
    const failures: AnalysisFailure[] = [];
    try {
      for (let index = 0; index < unique.length; index++) {
        const target = unique[index];
        this.reanalysisCurrent.set(index + 1);
        this.reanalysisDataset.set(target.datasetName);
        try {
          const before = this.datasetWorkflow(target.datasetId);
          if (!before?.activeVersionId || (target.expectedVersionId != null && before.activeVersionId !== target.expectedVersionId)) {
            failures.push(this.analysisConflict(target));
            continue;
          }
          await firstValueFrom(this.api.analyzeDataset(target.datasetId, { analysisType: 'profile' }));
          const workflow = await firstValueFrom(this.workflowContext.load(this.projectId, true));
          const current = workflow?.datasets.find((dataset) => dataset.datasetId === target.datasetId);
          if (!current?.hasCurrentAnalysis || current.requiresAnalysis || current.activeVersionId !== before.activeVersionId) {
            failures.push(this.analysisConflict(target));
            continue;
          }
          const saved = await firstValueFrom(this.api.getDatasetAnalysis(target.datasetId));
          if (!this.savedAnalysisMatchesWorkflow(saved, current)) failures.push(this.analysisConflict(target));
        } catch (error: unknown) {
          if (this.isActiveVersionConflict(error)) {
            await firstValueFrom(this.workflowContext.load(this.projectId, true));
            failures.push(this.analysisConflict(target));
          } else {
            failures.push({
              datasetId: target.datasetId,
              datasetName: target.datasetName,
              message: this.errorMessage(error, 'Automatic analysis failed.'),
              conflict: false,
            });
          }
        }
      }
    } finally {
      this.reanalyzing.set(false);
      this.reanalysisDataset.set('');
    }
    this.analysisFailures.set(failures);
    try {
      await this.reloadWorkspace(true);
    } catch (error: unknown) {
      this.loadError.set(this.errorMessage(error, 'The cleaning workspace could not be refreshed after analysis.'));
    }
    return failures;
  }

  private savedAnalysisMatchesWorkflow(analysis: DatasetAnalysisResponse, workflow: ProjectWorkflowDataset): boolean {
    return analysis.datasetVersionId != null
      && analysis.datasetVersionId === workflow.activeVersionId
      && (analysis.datasetVersionNumber == null || analysis.datasetVersionNumber === workflow.activeVersionNumber);
  }

  private analysisConflict(target: AnalysisTarget): AnalysisFailure {
    return {
      datasetId: target.datasetId,
      datasetName: target.datasetName,
      message: 'The active dataset version changed. Run analysis again for the current version.',
      conflict: true,
    };
  }

  private async recoverFromStaleVersion(): Promise<void> {
    this.closePreview(true);
    this.resetIssueSelection();
    try {
      await this.reloadWorkspace(true);
    } catch (error: unknown) {
      this.loadError.set(this.errorMessage(error, 'The cleaning workspace could not be refreshed.'));
    } finally {
      this.feedback.set({
        kind: 'warning',
        title: 'Preview expired',
        message: 'The active dataset version changed. Review the latest suggestions and preview again.',
      });
    }
  }

  private resetIssueSelection(): void {
    this.selectedIds.set(new Set());
    this.strategyOverrides.set({});
    this.customValues.set({});
    this.duplicateColumns.set({});
  }

  private invalidatePreview(): void {
    this.preview.set(null);
    this.previewOperations.set([]);
    this.destructiveConfirmed.set(false);
  }

  private dismissConfirmDialog(): void {
    this.confirmDialog()?.nativeElement.close();
    this.confirmAction.set(null);
  }

  private updateDatasetQuery(datasetId: number | null, replaceUrl: boolean): void {
    this.queryDatasetValue = datasetId === null ? null : String(datasetId);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      replaceUrl,
      queryParams: { datasetId, issueType: null, column: null, search: null },
    });
  }

  private removeLegacyFilterParams(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      replaceUrl: true,
      queryParams: { issueType: null, column: null, search: null },
    });
  }

  private isActiveVersionConflict(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse) && (typeof error !== 'object' || error === null)) return false;
    const candidate = error as { status?: number; error?: { code?: unknown; detail?: unknown; message?: unknown } };
    if (candidate.status !== 409) return false;
    if (candidate.error?.code === 'active_version_changed') return true;
    const message = candidate.error?.message ?? candidate.error?.detail;
    return typeof message === 'string' && /active dataset version changed/i.test(message);
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const detail = error.error?.detail ?? error.error?.message;
      if (typeof detail === 'string' && detail.trim()) return detail;
    }
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const body = error.error;
      if (typeof body === 'object' && body !== null) {
        const detail = 'detail' in body ? body.detail : 'message' in body ? body.message : null;
        if (typeof detail === 'string' && detail.trim()) return detail;
      }
    }
    return fallback;
  }
}
