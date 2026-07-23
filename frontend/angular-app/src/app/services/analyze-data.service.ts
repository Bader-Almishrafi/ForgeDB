import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, concatMap, finalize, forkJoin, from, map, Observable, of, switchMap, tap, toArray } from 'rxjs';
import {
  DatasetAnalysisResponse,
  DatasetResponse,
  ProjectResponse,
  ProjectWorkflow,
  ProjectWorkflowDataset,
} from './api.models';
import { ForgeApiService } from './forge-api.service';
import { ProjectWorkflowContextService } from './project-workflow-context.service';

export type AnalysisScope = 'project' | number;

export interface AnalysisFailure {
  datasetId: number;
  datasetName: string;
  message: string;
  conflict: boolean;
}

interface AnalysisRunOutcome {
  dataset: DatasetResponse;
  analysis: DatasetAnalysisResponse | null;
  failure: AnalysisFailure | null;
}

@Injectable()
export class AnalyzeDataService {
  private readonly api = inject(ForgeApiService);
  readonly workflowContext = inject(ProjectWorkflowContextService);

  private loadVersion = 0;
  projectId = 0;

  readonly project = signal<ProjectResponse | null>(null);
  readonly datasets = signal<DatasetResponse[]>([]);
  readonly analyses = signal<Record<number, DatasetAnalysisResponse>>({});
  readonly scope = signal<AnalysisScope>('project');
  readonly loading = signal(false);
  readonly resultsLoading = signal(false);
  readonly loadError = signal('');
  readonly scopeNotice = signal('');
  readonly resultLoadFailures = signal<AnalysisFailure[]>([]);
  readonly running = signal(false);
  readonly progressCurrent = signal(0);
  readonly progressTotal = signal(0);
  readonly progressDataset = signal('');
  readonly executionFailures = signal<AnalysisFailure[]>([]);
  readonly feedback = signal<{ kind: 'success' | 'warning' | 'error'; message: string } | null>(null);

  readonly projectName = computed(() => this.project()?.name ?? this.workflowContext.workflow()?.projectName ?? 'Project');
  readonly selectedDataset = computed(() => {
    const scope = this.scope();
    return typeof scope === 'number' ? this.datasets().find((dataset) => dataset.id === scope) ?? null : null;
  });
  readonly projectScope = computed(() => this.scope() === 'project');
  readonly scopeDatasets = computed(() => this.selectedDataset() ? [this.selectedDataset()!] : this.datasets());
  readonly currentAnalyses = computed(() => {
    const current: Record<number, DatasetAnalysisResponse> = {};
    for (const analysis of Object.values(this.analyses())) {
      const metadata = this.workflowDataset(analysis.datasetId);
      if (metadata && this.isResponseCurrent(analysis, metadata)) current[analysis.datasetId] = analysis;
    }
    return current;
  });
  readonly scopeAnalyses = computed(() => {
    const ids = new Set(this.scopeDatasets().map((dataset) => dataset.id));
    return Object.values(this.currentAnalyses()).filter((analysis) => ids.has(analysis.datasetId));
  });
  readonly scopeHasSavedAnalysis = computed(() => this.scopeAnalyses().length > 0);
  
  readonly analysisActionLabel = computed(() => {
    if (this.running()) return this.projectScope() ? 'Analyzing Project…' : 'Analyzing Dataset…';
    const prefix = this.scopeHasSavedAnalysis() ? 'Re-analyze' : 'Analyze';
    return `${prefix} ${this.projectScope() ? 'Project' : 'Dataset'}`;
  });
  
  readonly canContinueToClean = computed(() => this.workflowContext.workflow()?.canClean === true);
  readonly cleanBlockingReason = computed(() => this.workflowContext.workflow()?.blockingReasons[0] ?? 'Complete analysis for every active dataset version first.');

  loadWorkspace(projectId: number, initialDatasetId: number | null): void {
    this.projectId = projectId;
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.loadError.set('');
    forkJoin({
      project: this.api.getProject(this.projectId),
      datasets: this.api.getProjectDatasets(this.projectId),
      workflow: this.workflowContext.load(this.projectId),
    }).pipe(finalize(() => { if (version === this.loadVersion) this.loading.set(false); })).subscribe({
      next: ({ project, datasets, workflow }) => {
        if (version !== this.loadVersion) return;
        const ordered = [...datasets].sort((left, right) => left.id - right.id);
        this.project.set(project);
        this.datasets.set(ordered);
        this.applyRouteScope(initialDatasetId);
        this.loadSavedAnalyses(ordered, workflow, version);
      },
      error: (error: unknown) => {
        if (version === this.loadVersion) this.loadError.set(this.errorText(error, 'Unable to load project analysis.'));
      },
    });
  }

  setScope(value: AnalysisScope): void {
    if (value === 'project') {
      this.scope.set('project');
      this.scopeNotice.set('');
      return;
    }
    const datasetId = Number(value);
    if (!this.datasets().some((dataset) => dataset.id === datasetId)) return;
    this.scope.set(datasetId);
    this.scopeNotice.set('');
  }

  applyRouteScope(queryDatasetId: number | null): void {
    if (queryDatasetId === null) {
      this.scope.set('project');
      this.scopeNotice.set('');
      return;
    }
    const datasetId = Number(queryDatasetId);
    const selected = Number.isInteger(datasetId) && datasetId > 0
      ? this.datasets().find((dataset) => dataset.id === datasetId)
      : null;
    if (selected) {
      this.scope.set(selected.id);
      this.scopeNotice.set('');
      return;
    }
    this.scope.set('project');
    this.scopeNotice.set('The selected dataset is not in this project. Showing all datasets.');
  }

  runAnalysis(): void {
    if (this.running()) return;
    const targets = this.selectedDataset() ? [this.selectedDataset()!] : this.datasets();
    if (!targets.length) return;

    this.running.set(true);
    this.progressCurrent.set(0);
    this.progressTotal.set(targets.length);
    this.progressDataset.set('');
    this.executionFailures.set([]);
    this.feedback.set(null);

    from(targets).pipe(
      concatMap((dataset) => {
        this.progressDataset.set(dataset.tableName);
        return this.analyzeOne(dataset).pipe(tap((outcome) => {
          this.progressCurrent.update((current) => current + 1);
          if (outcome.analysis) {
            this.analyses.update((analyses) => ({ ...analyses, [dataset.id]: outcome.analysis! }));
            this.resultLoadFailures.update((failures) => failures.filter((failure) => failure.datasetId !== dataset.id));
          } else if (outcome.failure?.conflict) {
            this.removeAnalysis(dataset.id);
          }
        }));
      }),
      toArray(),
      finalize(() => {
        this.running.set(false);
        this.progressDataset.set('');
      }),
    ).subscribe((outcomes) => {
      const failures = outcomes.flatMap((outcome) => outcome.failure ? [outcome.failure] : []);
      const successes = outcomes.length - failures.length;
      this.executionFailures.set(failures);
      if (!failures.length) {
        this.feedback.set({ kind: 'success', message: `Analysis completed for ${successes} dataset${successes === 1 ? '' : 's'}.` });
      } else if (successes > 0) {
        this.feedback.set({ kind: 'warning', message: `${successes} dataset${successes === 1 ? '' : 's'} analyzed; ${failures.length} failed.` });
      } else {
        this.feedback.set({ kind: 'error', message: 'Analysis could not be completed. Review the failures and try again.' });
      }
    });
  }

  workflowDataset(datasetId: number): ProjectWorkflowDataset | null {
    return this.workflowContext.workflow()?.datasets.find((dataset) => dataset.datasetId === datasetId) ?? null;
  }

  datasetAnalysisStatus(datasetId: number): 'Analyzed' | 'Analysis required' | 'Re-analysis required' | 'Status unavailable' {
    const metadata = this.workflowDataset(datasetId);
    if (!metadata) return 'Status unavailable';
    if (metadata.hasCurrentAnalysis && !metadata.requiresAnalysis) return 'Analyzed';
    return metadata.requiresAnalysis && (metadata.activeVersionNumber ?? 1) > 1 ? 'Re-analysis required' : 'Analysis required';
  }

  datasetVersion(datasetId: number): string {
    const version = this.workflowDataset(datasetId)?.activeVersionNumber;
    return version ? `v${version}` : '—';
  }

  private loadSavedAnalyses(datasets: DatasetResponse[], workflow: ProjectWorkflow | null, version: number): void {
    const eligible = datasets.filter((dataset) => {
      const metadata = workflow?.datasets.find((item) => item.datasetId === dataset.id);
      return metadata?.hasCurrentAnalysis === true && metadata.requiresAnalysis === false;
    });
    this.analyses.set({});
    this.resultLoadFailures.set([]);
    if (!eligible.length) {
      this.resultsLoading.set(false);
      return;
    }

    this.resultsLoading.set(true);
    from(eligible).pipe(
      concatMap((dataset) => this.api.getDatasetAnalysis(dataset.id).pipe(
        map((analysis): AnalysisRunOutcome => {
          const metadata = workflow?.datasets.find((item) => item.datasetId === dataset.id);
          return metadata && this.isResponseCurrent(analysis, metadata)
            ? { dataset, analysis, failure: null }
            : { dataset, analysis: null, failure: this.conflictFailure(dataset) };
        }),
        catchError((error: unknown) => of<AnalysisRunOutcome>({
          dataset,
          analysis: null,
          failure: { datasetId: dataset.id, datasetName: dataset.tableName, message: this.errorText(error, 'Saved analysis could not be loaded.'), conflict: false },
        })),
      )),
      toArray(),
    ).subscribe((outcomes) => {
      if (version !== this.loadVersion) return;
      const analyses: Record<number, DatasetAnalysisResponse> = {};
      const failures: AnalysisFailure[] = [];
      for (const outcome of outcomes) {
        if (outcome.analysis) analyses[outcome.dataset.id] = outcome.analysis;
        if (outcome.failure) failures.push(outcome.failure);
      }
      this.analyses.set(analyses);
      this.resultLoadFailures.set(failures);
      this.resultsLoading.set(false);
    });
  }

  private analyzeOne(dataset: DatasetResponse): Observable<AnalysisRunOutcome> {
    return this.api.analyzeDataset(dataset.id, { analysisType: 'profile' }).pipe(
      switchMap(() => this.workflowContext.load(this.projectId, true)),
      switchMap((latestWorkflow) => {
        if (!latestWorkflow) {
          return of<AnalysisRunOutcome>({
            dataset,
            analysis: null,
            failure: { datasetId: dataset.id, datasetName: dataset.tableName, message: 'Analysis finished, but the active version could not be verified. Try again.', conflict: false },
          });
        }
        const metadata = latestWorkflow.datasets.find((item) => item.datasetId === dataset.id);
        if (!metadata?.hasCurrentAnalysis || metadata.requiresAnalysis) {
          return of<AnalysisRunOutcome>({ dataset, analysis: null, failure: this.conflictFailure(dataset) });
        }
        return this.api.getDatasetAnalysis(dataset.id).pipe(map((analysis): AnalysisRunOutcome =>
          this.isResponseCurrent(analysis, metadata)
            ? { dataset, analysis, failure: null }
            : { dataset, analysis: null, failure: this.conflictFailure(dataset) }));
      }),
      catchError((error: unknown) => {
        if (this.isConflict(error)) {
          const outcome: AnalysisRunOutcome = {
            dataset,
            analysis: null,
            failure: this.conflictFailure(dataset),
          };
          return this.workflowContext.load(this.projectId, true).pipe(
            map(() => outcome),
            catchError(() => of(outcome)),
          );
        }
        return of<AnalysisRunOutcome>({
          dataset,
          analysis: null,
          failure: { datasetId: dataset.id, datasetName: dataset.tableName, message: this.errorText(error, 'Analysis failed.'), conflict: false },
        });
      }),
    );
  }

  private isResponseCurrent(analysis: DatasetAnalysisResponse, metadata: ProjectWorkflowDataset): boolean {
    if (!metadata.hasCurrentAnalysis || metadata.requiresAnalysis) return false;
    if (analysis.datasetVersionId != null && metadata.activeVersionId != null && analysis.datasetVersionId !== metadata.activeVersionId) return false;
    if (analysis.datasetVersionNumber != null && metadata.activeVersionNumber != null && analysis.datasetVersionNumber !== metadata.activeVersionNumber) return false;
    return true;
  }

  private removeAnalysis(datasetId: number): void {
    this.analyses.update((analyses) => {
      const updated = { ...analyses };
      delete updated[datasetId];
      return updated;
    });
  }

  private conflictFailure(dataset: DatasetResponse): AnalysisFailure {
    return {
      datasetId: dataset.id,
      datasetName: dataset.tableName,
      message: 'The active dataset version changed while analysis was running. Run analysis again.',
      conflict: true,
    };
  }

  private isConflict(error: unknown): boolean {
    return error instanceof HttpErrorResponse ? error.status === 409 : typeof error === 'object' && error !== null && 'status' in error && error.status === 409;
  }

  private errorText(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const body = error.error;
      if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string' && body.message.trim()) return body.message;
    }
    return fallback;
  }
}
