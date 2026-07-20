import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, concatMap, finalize, forkJoin, from, map, Observable, of, switchMap, tap, toArray } from 'rxjs';
import {
  ChartRecommendation,
  ColumnAnalysis,
  DatasetAnalysisResponse,
  DatasetResponse,
  ProjectResponse,
  ProjectWorkflow,
  ProjectWorkflowDataset,
} from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { routeParameter } from '../../services/route-context';
import { AnalysisChartComponent, AnalysisChartPoint } from './analysis-chart.component';

type AnalysisScope = 'project' | number;

interface AnalysisFailure {
  datasetId: number;
  datasetName: string;
  message: string;
  conflict: boolean;
}

interface AnalysisIssue {
  key: string;
  datasetName: string;
  type: 'Missing values' | 'Duplicate rows';
  column: string | null;
  count: number;
  percentage: number | null;
}

interface AnalysisColumnRow {
  key: string;
  datasetName: string;
  column: ColumnAnalysis;
  missingPercentage: number | null;
}

interface AnalysisSummary {
  analyzedDatasets: number;
  requiresAnalysis: number;
  rows: number;
  columns: number;
  missingValues: number;
  duplicateRows: number;
  lastAnalyzedAt: string | null;
}

interface AnalysisRecommendation {
  key: string;
  datasetName: string;
  recommendation: ChartRecommendation;
}

interface AnalysisRunOutcome {
  dataset: DatasetResponse;
  analysis: DatasetAnalysisResponse | null;
  failure: AnalysisFailure | null;
}

@Component({
  selector: 'app-analyze-data',
  standalone: true,
  imports: [AnalysisChartComponent, DatePipe, DecimalPipe, FormsModule, RouterLink],
  templateUrl: './analyze-data.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyzeDataComponent implements OnInit {
  private readonly api = inject(ForgeApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly workflowContext = inject(ProjectWorkflowContextService);
  private queryDatasetValue: string | null = null;
  private loadVersion = 0;

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
  readonly columnSearch = signal('');
  projectId = 0;

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
  readonly summary = computed<AnalysisSummary>(() => {
    const analyses = this.scopeAnalyses();
    const analyzedAt = analyses.map((analysis) => analysis.analyzedAt).filter((value): value is string => !!value).sort().at(-1) ?? null;
    return {
      analyzedDatasets: analyses.length,
      requiresAnalysis: this.scopeDatasets().filter((dataset) => this.datasetAnalysisStatus(dataset.id) !== 'Analyzed').length,
      rows: analyses.reduce((sum, analysis) => sum + analysis.analysisResult.rowCount, 0),
      columns: analyses.reduce((sum, analysis) => sum + analysis.analysisResult.columnCount, 0),
      missingValues: analyses.reduce((sum, analysis) => sum + analysis.analysisResult.missingValuesCount, 0),
      duplicateRows: analyses.reduce((sum, analysis) => sum + analysis.analysisResult.duplicateRowsCount, 0),
      lastAnalyzedAt: analyzedAt,
    };
  });
  readonly issues = computed<AnalysisIssue[]>(() => {
    const issues: AnalysisIssue[] = [];
    for (const analysis of this.scopeAnalyses()) {
      const datasetName = this.datasetName(analysis.datasetId, analysis.tableName);
      const rows = analysis.analysisResult.rowCount;
      if (analysis.analysisResult.duplicateRowsCount > 0) {
        issues.push({
          key: `${analysis.datasetId}:duplicates`,
          datasetName,
          type: 'Duplicate rows',
          column: null,
          count: analysis.analysisResult.duplicateRowsCount,
          percentage: rows > 0 ? analysis.analysisResult.duplicateRowsCount / rows * 100 : null,
        });
      }
      for (const column of analysis.analysisResult.columns) {
        if (column.missingValuesCount <= 0) continue;
        issues.push({
          key: `${analysis.datasetId}:missing:${column.columnName}`,
          datasetName,
          type: 'Missing values',
          column: column.columnName,
          count: column.missingValuesCount,
          percentage: rows > 0 ? column.missingValuesCount / rows * 100 : null,
        });
      }
    }
    return issues.sort((left, right) => right.count - left.count);
  });
  readonly columns = computed<AnalysisColumnRow[]>(() => this.scopeAnalyses().flatMap((analysis) => {
    const datasetName = this.datasetName(analysis.datasetId, analysis.tableName);
    const rows = analysis.analysisResult.rowCount;
    return analysis.analysisResult.columns.map((column) => ({
      key: `${analysis.datasetId}:${column.columnName}`,
      datasetName,
      column,
      missingPercentage: rows > 0 ? column.missingValuesCount / rows * 100 : null,
    }));
  }));
  readonly filteredColumns = computed(() => {
    const query = this.columnSearch().trim().toLocaleLowerCase();
    return query
      ? this.columns().filter((row) => `${row.datasetName} ${row.column.columnName} ${row.column.detectedDataType}`.toLocaleLowerCase().includes(query))
      : this.columns();
  });
  readonly recommendations = computed<AnalysisRecommendation[]>(() => this.scopeAnalyses().flatMap((analysis) =>
    analysis.chartRecommendations.map((recommendation, index) => ({
      key: `${analysis.datasetId}:${index}:${recommendation.title}`,
      datasetName: this.datasetName(analysis.datasetId, analysis.tableName),
      recommendation,
    }))).slice(0, 8));
  readonly missingChartPoints = computed<AnalysisChartPoint[]>(() => {
    if (this.projectScope()) {
      return this.scopeAnalyses()
        .map((analysis) => ({ label: this.datasetName(analysis.datasetId, analysis.tableName), value: analysis.analysisResult.missingValuesCount }))
        .filter((point) => point.value > 0)
        .sort((left, right) => right.value - left.value)
        .slice(0, 10);
    }
    const analysis = this.scopeAnalyses()[0];
    return (analysis?.analysisResult.columns ?? [])
      .map((column) => ({ label: column.columnName, value: column.missingValuesCount }))
      .filter((point) => point.value > 0)
      .sort((left, right) => right.value - left.value)
      .slice(0, 10);
  });
  readonly typeChartPoints = computed<AnalysisChartPoint[]>(() => {
    const totals = new Map<string, number>();
    for (const analysis of this.scopeAnalyses()) {
      for (const item of analysis.analysisResult.columnTypeDistribution) {
        totals.set(item.dataType, (totals.get(item.dataType) ?? 0) + item.count);
      }
    }
    return [...totals.entries()].map(([label, value]) => ({ label, value })).sort((left, right) => right.value - left.value);
  });
  readonly duplicateChartPoints = computed<AnalysisChartPoint[]>(() => this.scopeAnalyses()
    .map((analysis) => ({ label: this.datasetName(analysis.datasetId, analysis.tableName), value: analysis.analysisResult.duplicateRowsCount }))
    .filter((point) => point.value > 0)
    .sort((left, right) => right.value - left.value));
  readonly analysisActionLabel = computed(() => {
    if (this.running()) return this.projectScope() ? 'Analyzing Project…' : 'Analyzing Dataset…';
    const prefix = this.scopeHasSavedAnalysis() ? 'Re-analyze' : 'Analyze';
    return `${prefix} ${this.projectScope() ? 'Project' : 'Dataset'}`;
  });
  readonly canContinueToClean = computed(() => this.workflowContext.workflow()?.canClean === true);
  readonly cleanBlockingReason = computed(() => this.workflowContext.workflow()?.blockingReasons[0] ?? 'Complete analysis for every active dataset version first.');
  readonly selectedAnalysis = computed(() => {
    const dataset = this.selectedDataset();
    return dataset ? this.currentAnalyses()[dataset.id] ?? null : null;
  });
  readonly analysisEngines = computed(() => [...new Set(this.scopeAnalyses()
    .map((analysis) => analysis.analysisEngine?.trim())
    .filter((engine): engine is string => !!engine))]);

  ngOnInit(): void {
    this.projectId = routeParameter(this.route, 'projectId') ?? 0;
    if (this.projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.queryDatasetValue = params.get('datasetId');
      if (this.datasets().length) this.applyRouteScope();
    });
    this.loadWorkspace();
  }

  loadWorkspace(): void {
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
        this.applyRouteScope();
        this.loadSavedAnalyses(ordered, workflow, version);
      },
      error: (error: unknown) => {
        if (version === this.loadVersion) this.loadError.set(this.errorText(error, 'Unable to load project analysis.'));
      },
    });
  }

  changeScope(value: AnalysisScope): void {
    if (value === 'project') {
      this.scope.set('project');
      this.scopeNotice.set('');
      this.updateDatasetQuery(null, false);
      return;
    }
    const datasetId = Number(value);
    if (!this.datasets().some((dataset) => dataset.id === datasetId)) return;
    this.scope.set(datasetId);
    this.scopeNotice.set('');
    this.updateDatasetQuery(datasetId, false);
  }

  openDataset(datasetId: number): void {
    this.changeScope(datasetId);
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

  continueToClean(): void {
    if (!this.canContinueToClean()) return;
    const datasetId = this.selectedDataset()?.id;
    void this.router.navigate(['/projects', this.projectId, 'clean'], { queryParams: datasetId ? { datasetId } : {} });
  }

  datasetAnalysisStatus(datasetId: number): 'Analyzed' | 'Analysis required' | 'Re-analysis required' | 'Status unavailable' {
    const metadata = this.workflowDataset(datasetId);
    if (!metadata) return 'Status unavailable';
    if (metadata.hasCurrentAnalysis && !metadata.requiresAnalysis) return 'Analyzed';
    return metadata.requiresAnalysis && (metadata.activeVersionNumber ?? 1) > 1 ? 'Re-analysis required' : 'Analysis required';
  }

  workflowDataset(datasetId: number): ProjectWorkflowDataset | null {
    return this.workflowContext.workflow()?.datasets.find((dataset) => dataset.datasetId === datasetId) ?? null;
  }

  datasetVersion(datasetId: number): string {
    const version = this.workflowDataset(datasetId)?.activeVersionNumber;
    return version ? `v${version}` : '—';
  }

  analyzedVersionLabel(): string {
    const selected = this.selectedAnalysis();
    if (selected?.datasetVersionNumber) return `v${selected.datasetVersionNumber}`;
    return this.projectScope() ? `${this.summary().analyzedDatasets} current version${this.summary().analyzedDatasets === 1 ? '' : 's'}` : '—';
  }

  backToDataQuery(): { datasetId: number } | Record<string, never> {
    const datasetId = this.selectedDataset()?.id;
    return datasetId ? { datasetId } : {};
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

  private applyRouteScope(): void {
    if (this.queryDatasetValue === null) {
      this.scope.set('project');
      this.scopeNotice.set('');
      return;
    }
    const datasetId = Number(this.queryDatasetValue);
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
    this.updateDatasetQuery(null, true);
  }

  private updateDatasetQuery(datasetId: number | null, replaceUrl: boolean): void {
    this.queryDatasetValue = datasetId === null ? null : String(datasetId);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { datasetId },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
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

  private datasetName(datasetId: number, fallback: string): string {
    return this.datasets().find((dataset) => dataset.id === datasetId)?.tableName ?? fallback;
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
