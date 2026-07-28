import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import {
  CleaningApplyResponse,
  CleaningHistoryEntry,
  CleaningOperationRequest,
  CleaningPreviewResponse,
  CleaningSuggestion,
  DatasetAnalysisResponse,
  DatasetCleaningSummary,
  DatasetVersion,
  ProjectCleaningSummary,
  ProjectWorkflowDataset,
} from '../../../services/api.models';
import { ForgeApiService } from '../../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../../services/project-workflow-context.service';
import { validateCleaningOperation } from './cleaning-transformations';

export interface FeedbackMessage {
  kind: 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

export interface AnalysisTarget {
  datasetId: number;
  datasetName: string;
  expectedVersionId: number | null;
}

export interface AnalysisFailure {
  datasetId: number;
  datasetName: string;
  message: string;
  conflict: boolean;
}

export type ConfirmAction = { kind: 'undo' } | { kind: 'restore'; datasetId: number; version: DatasetVersion };

@Injectable()
export class DataCleaningApiService {
  private readonly forgeApi = inject(ForgeApiService);
  private readonly workflowContext = inject(ProjectWorkflowContextService);

  projectId = 0;
  private loadVersion = 0;
  private versionCacheGeneration = 0;
  private previewRequestToken = 0;
  private readonly versionRequests = new Map<number, { token: symbol; promise: Promise<void> }>();

  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly summary = signal<ProjectCleaningSummary | null>(null);
  readonly suggestions = signal<CleaningSuggestion[]>([]);
  readonly history = signal<CleaningHistoryEntry[]>([]);
  readonly versions = signal<Record<number, DatasetVersion[]>>({});
  
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

  readonly projectName = computed(() => this.workflowContext.workflow()?.projectName ?? this.summary()?.projectName ?? 'Project');
  readonly datasets = computed(() => this.summary()?.datasets ?? []);
  readonly issueCountByDataset = computed(() => {
    const counts: Record<number, number> = {};
    for (const suggestion of this.suggestions()) {
      counts[suggestion.datasetId] = (counts[suggestion.datasetId] ?? 0) + 1;
    }
    return counts;
  });

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

  loadWorkspace(projectId: number): void {
    this.projectId = projectId;
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.loadError.set('');
    forkJoin({
      summary: this.forgeApi.getProjectCleaningSummary(this.projectId),
      suggestions: this.forgeApi.getCleaningSuggestions(this.projectId),
      history: this.forgeApi.getCleaningHistory(this.projectId),
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
        this.loading.set(false);
      },
      error: (error: unknown) => {
        if (version !== this.loadVersion) return;
        this.loadError.set(this.errorMessage(error, 'Unable to load the cleaning workspace.'));
        this.loading.set(false);
      },
    });
  }

  async reloadWorkspace(forceWorkflow: boolean): Promise<void> {
    const { summary, suggestions, history, workflow } = await firstValueFrom(forkJoin({
      summary: this.forgeApi.getProjectCleaningSummary(this.projectId),
      suggestions: this.forgeApi.getCleaningSuggestions(this.projectId),
      history: this.forgeApi.getCleaningHistory(this.projectId),
      workflow: this.workflowContext.load(this.projectId, forceWorkflow),
    }));
    if (!workflow) throw new Error('Project workflow could not be refreshed.');
    this.setWorkspaceData(summary, suggestions, history.entries);
  }

  private setWorkspaceData(summary: ProjectCleaningSummary, suggestions: CleaningSuggestion[], history: CleaningHistoryEntry[]): void {
    this.summary.set(summary);
    this.suggestions.set(suggestions);
    this.history.set(history);
  }

  async loadVersions(datasetId: number): Promise<void> {
    const existing = this.versionRequests.get(datasetId);
    if (existing) return existing.promise;

    const generation = this.versionCacheGeneration;
    const token = Symbol();
    const request = (async () => {
      try {
        const versions = await firstValueFrom(this.forgeApi.getDatasetVersions(this.projectId, datasetId));
        if (generation === this.versionCacheGeneration) {
          this.versions.update((current) => ({ ...current, [datasetId]: versions }));
        }
      } catch {
        if (generation === this.versionCacheGeneration) {
          this.versions.update((current) => ({ ...current, [datasetId]: [] }));
        }
      } finally {
        if (this.versionRequests.get(datasetId)?.token === token) this.versionRequests.delete(datasetId);
      }
    })();
    this.versionRequests.set(datasetId, { token, promise: request });
    return request;
  }

  clearVersions(datasetIds?: number[]): void {
    if (datasetIds?.length === 0) return;
    this.versionCacheGeneration++;
    this.versionRequests.clear();
    if (!datasetIds) {
      this.versions.set({});
      return;
    }
    const ids = new Set(datasetIds);
    this.versions.update((current) => Object.fromEntries(
      Object.entries(current).filter(([datasetId]) => !ids.has(Number(datasetId)))
    ));
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

  affectedDatasetNames(entry: CleaningHistoryEntry): string {
    return [...new Set(entry.operations.map((operation) => operation.datasetName))].join(', ') || 'None';
  }

  isActiveVersionConflict(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse) && (typeof error !== 'object' || error === null)) return false;
    const candidate = error as { status?: number; error?: { code?: unknown; detail?: unknown; message?: unknown } };
    if (candidate.status !== 409) return false;
    if (candidate.error?.code === 'active_version_changed') return true;
    const message = candidate.error?.message ?? candidate.error?.detail;
    return typeof message === 'string' && /active dataset version changed/i.test(message);
  }

  async previewOperationsRequest(operations: CleaningOperationRequest[]): Promise<void> {
    if (!operations.length || this.previewLoading() || this.applyLoading() || this.reanalyzing() || !this.cleaningReady()) return;
    const invalidOperation = operations
      .map((operation) => validateCleaningOperation(operation))
      .find((validation) => !validation.valid);
    if (invalidOperation) {
      this.invalidatePreview();
      this.feedback.set({
        kind: 'error',
        title: 'Complete the cleaning strategy',
        message: invalidOperation.error ?? 'Review the selected cleaning values before previewing.',
      });
      return;
    }
    this.invalidatePreview();
    const requestToken = this.previewRequestToken;
    this.previewLoading.set(true);
    this.feedback.set(null);
    try {
      const preview = await firstValueFrom(this.forgeApi.previewCleaning(this.projectId, { operations }));
      if (requestToken !== this.previewRequestToken) return;
      if (!this.previewMatchesExpectedVersions(preview, operations)) {
        await this.recoverFromStaleVersion({
          kind: 'warning',
          title: 'Preview incomplete',
          message: 'The preview did not cover every selected dataset at its expected active version. Nothing was changed; review the refreshed recommendations and preview again.',
        });
        return;
      }
      this.preview.set(preview);
      this.previewOperations.set(operations);
      this.destructiveConfirmed.set(false);
      return Promise.resolve();
    } catch (error: unknown) {
      if (requestToken !== this.previewRequestToken) return;
      if (this.isActiveVersionConflict(error)) await this.recoverFromStaleVersion();
      else this.feedback.set({ kind: 'error', title: 'Preview failed', message: this.errorMessage(error, 'The selected changes could not be previewed.') });
    } finally {
      if (requestToken === this.previewRequestToken) this.previewLoading.set(false);
    }
  }

  private previewMatchesExpectedVersions(preview: CleaningPreviewResponse, operations: CleaningOperationRequest[]): boolean {
    const operationsByDataset = new Map<number, CleaningOperationRequest[]>();
    for (const operation of operations) {
      const datasetOperations = operationsByDataset.get(operation.datasetId) ?? [];
      datasetOperations.push(operation);
      operationsByDataset.set(operation.datasetId, datasetOperations);
    }

    if (preview.datasets.length !== operationsByDataset.size) return false;
    return [...operationsByDataset.entries()].every(([datasetId, datasetOperations]) => {
      const matchingPreviews = preview.datasets.filter((dataset) => dataset.datasetId === datasetId);
      return matchingPreviews.length === 1
        && datasetOperations.every((operation) => operation.expectedSourceVersionId === matchingPreviews[0].sourceVersionId);
    });
  }

  async recoverFromStaleVersion(message: FeedbackMessage = {
    kind: 'warning',
    title: 'Preview expired',
    message: 'The active dataset version changed. Review the latest suggestions and preview again.',
  }): Promise<void> {
    this.invalidatePreview();
    this.history.set([]);
    this.clearVersions();
    try {
      await this.reloadWorkspace(true);
    } catch (error: unknown) {
      this.loadError.set(this.errorMessage(error, 'The cleaning workspace could not be refreshed.'));
    } finally {
      this.feedback.set(message);
    }
  }

  invalidatePreview(): void {
    this.previewRequestToken++;
    this.preview.set(null);
    this.previewOperations.set([]);
    this.destructiveConfirmed.set(false);
    this.previewLoading.set(false);
  }

  async applyPreview(onSuccess?: () => void): Promise<void> {
    const preview = this.preview();
    if (!preview || this.previewLoading() || this.applyLoading() || this.reanalyzing()
      || (preview.destructive && !this.destructiveConfirmed())) return;
    const invalidOperation = this.previewOperations()
      .map((operation) => validateCleaningOperation(operation))
      .find((validation) => !validation.valid);
    if (invalidOperation) {
      this.feedback.set({
        kind: 'error',
        title: 'Complete the cleaning strategy',
        message: invalidOperation.error ?? 'Review the selected cleaning values before applying.',
      });
      return;
    }
    
    this.applyLoading.set(true);
    try {
      const result = await firstValueFrom(this.forgeApi.applyCleaning(this.projectId, {
        batchName: this.previewOperations().length === 1
          ? 'Apply reviewed cleaning fix'
          : `Apply ${this.previewOperations().length} reviewed fixes`,
        confirmDestructive: this.destructiveConfirmed(),
        operations: this.previewOperations(),
      }));
      onSuccess?.();
      await this.processVersionResult(result, 'Cleaning changes applied');
    } catch (error: unknown) {
      if (this.isActiveVersionConflict(error)) await this.recoverFromStaleVersion();
      else this.feedback.set({ kind: 'error', title: 'Apply failed', message: this.errorMessage(error, 'The reviewed changes could not be applied.') });
    } finally {
      this.applyLoading.set(false);
    }
  }

  async confirmUndoOrRestore(onSuccess?: () => void): Promise<void> {
    const action = this.confirmAction();
    if (!action || this.previewLoading() || this.applyLoading() || this.reanalyzing()) return;
    this.applyLoading.set(true);
    try {
      const result = action.kind === 'undo'
        ? await firstValueFrom(this.forgeApi.undoLatestCleaning(this.projectId))
        : await firstValueFrom(this.forgeApi.restoreDatasetVersion(this.projectId, action.datasetId, action.version.id));
      onSuccess?.();
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
    if (!this.canConfirmQuality() || this.previewLoading() || this.applyLoading() || this.reanalyzing()) return;
    this.applyLoading.set(true);
    try {
      await firstValueFrom(this.forgeApi.confirmCleaningQuality(this.projectId));
      await this.reloadWorkspace(true);
      this.feedback.set({ kind: 'success', title: 'Quality confirmed', message: 'Data quality is confirmed for every current active dataset version.' });
    } catch (error: unknown) {
      this.feedback.set({ kind: 'error', title: 'Confirmation failed', message: this.errorMessage(error, 'Data quality could not be confirmed.') });
    } finally {
      this.applyLoading.set(false);
    }
  }

  async processVersionResult(result: CleaningApplyResponse, successTitle: string): Promise<void> {
    const successful = result.datasets.filter((dataset) => dataset.success && dataset.versionId != null);
    const cleaningFailures = result.datasets.filter((dataset) => !dataset.success);
    const changedDatasetIds = successful.map((dataset) => dataset.datasetId);
    this.invalidatePreview();
    this.history.set([]);
    this.clearVersions(changedDatasetIds);
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
        title: cleaningFailures.length ? 'Cleaning partially applied; refresh required' : 'Cleaning saved; refresh required',
        message: [
          this.errorMessage(error, 'New active versions were saved, but the workspace could not be refreshed.'),
          cleaningFailures.length
            ? `Cleaning failed for: ${this.cleaningFailureDetails(cleaningFailures)}`
            : '',
        ].filter(Boolean).join(' '),
      });
      return;
    }

    const targets = successful.map((dataset): AnalysisTarget => ({
      datasetId: dataset.datasetId,
      datasetName: dataset.datasetName,
      expectedVersionId: dataset.versionId ?? null,
    }));
    const analysisFailures = await this.analyzeTargets(targets);
    await Promise.all(changedDatasetIds.map((datasetId) => this.loadVersions(datasetId)));

    if (analysisFailures.length && cleaningFailures.length) {
      this.feedback.set({
        kind: 'warning',
        title: 'Cleaning partially applied; re-analysis incomplete',
        message: `${successful.length} dataset${successful.length === 1 ? '' : 's'} succeeded; cleaning failed for: ${this.cleaningFailureDetails(cleaningFailures)} New active versions remain preserved; analysis failed for: ${analysisFailures.map((failure) => failure.datasetName).join(', ')}.`,
      });
    } else if (analysisFailures.length) {
      this.feedback.set({
        kind: 'warning',
        title: 'Cleaning saved; re-analysis incomplete',
        message: `New active versions remain preserved. Analysis failed for: ${analysisFailures.map((failure) => failure.datasetName).join(', ')}.`,
      });
    } else if (cleaningFailures.length) {
      this.feedback.set({
        kind: 'warning',
        title: 'Cleaning partially applied',
        message: `${successful.length} succeeded; failed datasets: ${this.cleaningFailureDetails(cleaningFailures)}`,
      });
    } else {
      this.feedback.set({ kind: 'success', title: successTitle, message: 'The new active versions were analyzed successfully. Review quality before continuing.' });
    }
  }

  private cleaningFailureDetails(failures: CleaningApplyResponse['datasets']): string {
    const details = [...new Set(failures.map((failure) => {
      const reason = failure.error?.replace(/\s+/g, ' ').trim().slice(0, 180)
        || 'The server rejected this dataset operation.';
      return `${failure.datasetName}: ${reason.replace(/[.;:]+$/g, '')}.`;
    }))];
    const visible = details.slice(0, 4);
    const omitted = details.length - visible.length;
    return `${visible.join(' ')}${omitted ? ` ${omitted} additional failure(s) omitted.` : ''}`;
  }

  async analyzeTargets(targets: AnalysisTarget[]): Promise<AnalysisFailure[]> {
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
          await firstValueFrom(this.forgeApi.analyzeDataset(target.datasetId, { analysisType: 'profile' }));
          const workflow = await firstValueFrom(this.workflowContext.load(this.projectId, true));
          const current = workflow?.datasets.find((dataset) => dataset.datasetId === target.datasetId);
          if (!current?.hasCurrentAnalysis || current.requiresAnalysis || current.activeVersionId !== before.activeVersionId) {
            failures.push(this.analysisConflict(target));
            continue;
          }
          const saved = await firstValueFrom(this.forgeApi.getDatasetAnalysis(target.datasetId));
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

  errorMessage(error: unknown, fallback: string): string {
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

