import { CommonModule, Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ChartRecommendation, DashboardResponse, DashboardTopValues, DatasetAnalysisResponse, NumericColumnStats, ValueFrequency, DatasetResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  readonly dashboard = signal<DashboardResponse | null>(null);
  readonly profile = signal<DatasetAnalysisResponse | null>(null);
  readonly loading = signal(false);
  readonly analyzing = signal(false);

  datasetId = 0;
  errorMessage = '';
  successMessage = '';

  constructor(
    private api: ForgeApiService,
    private route: ActivatedRoute,
    private router: Router,
    private workflow: WorkflowStateService,
    private location: Location
  ) {}

  readonly datasets = signal<DatasetResponse[]>([]);

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.datasetId = Number(params.get('datasetId'));
      if (!Number.isFinite(this.datasetId) || this.datasetId <= 0) {
        this.router.navigate(['/projects']);
        return;
      }
      this.loadDashboard();
    });

    if (this.workflow.projectId()) {
      this.api.getProjectDatasets(this.workflow.projectId()!).subscribe(ds => {
        this.datasets.set(ds);
      });
    }
  }

  onDatasetSelect(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (select.value) {
      this.router.navigate(['/datasets', select.value, 'dashboard']);
    }
  }

  goBack(): void {
    this.location.back();
  }

  loadDashboard(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getDatasetDashboard(this.datasetId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (dashboard) => {
          this.dashboard.set(dashboard);
          this.workflow.setDatasetId(dashboard.datasetId, dashboard.tableName);
          this.loadProfile();
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load dashboard.';
        },
      });
  }

  analyzeAndRefresh(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.analyzing.set(true);

    this.api.analyzeDataset(this.datasetId, { analysisType: 'profile' })
      .pipe(finalize(() => this.analyzing.set(false)))
      .subscribe({
        next: () => {
          this.workflow.setDatasetId(this.datasetId, this.dashboard()?.tableName, 'Analyzed');
          this.successMessage = 'Analysis completed.';
          this.loadDashboard();
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to run analysis.';
        },
      });
  }

  loadProfile(): void {
    this.api.getDatasetProfile(this.datasetId).subscribe({
      next: (profile) => this.profile.set(profile),
      error: () => this.profile.set(null),
    });
  }

  qualityScore(data: DashboardResponse): number {
    const totalCells = Math.max(data.rowCount * data.columnCount, 1);
    const missingPenalty = (data.missingValuesCount / totalCells) * 60;
    const duplicatePenalty = (data.duplicateRowsCount / Math.max(data.rowCount, 1)) * 40;

    return Math.max(0, Math.round(100 - missingPenalty - duplicatePenalty));
  }

  qualityStatus(data: DashboardResponse): string {
    const score = this.qualityScore(data);
    if (score >= 95) {
      return 'Excellent';
    }

    if (score >= 80) {
      return 'Healthy';
    }

    if (score >= 60) {
      return 'Needs Review';
    }

    return 'High Risk';
  }

  qualityClass(data: DashboardResponse): string {
    const score = this.qualityScore(data);
    if (score >= 80) {
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    }

    if (score >= 60) {
      return 'border-amber-200 bg-amber-50 text-amber-800';
    }

    return 'border-rose-200 bg-rose-50 text-rose-800';
  }

  typePercent(data: DashboardResponse, count: number): number {
    return Math.round((count / Math.max(data.columnCount, 1)) * 100);
  }

  topValuePercent(summary: DashboardTopValues, count: number): number {
    const max = Math.max(...summary.values.map((value) => value.count), 1);
    return Math.round((count / max) * 100);
  }

  chartXColumn(chart: ChartRecommendation): string {
    return chart.xColumn || chart.columns[0] || 'column';
  }

  chartYColumn(chart: ChartRecommendation): string | null {
    return chart.yColumn || chart.columns[1] || (this.isCountChart(chart) ? 'count' : null);
  }

  chartUsefulness(chart: ChartRecommendation): string {
    return chart.usefulness || 'Suggested';
  }

  chartTypeLabel(chart: ChartRecommendation): string {
    return chart.chartType ? chart.chartType.replace(/_/g, ' ') : 'chart';
  }

  chartTypeClass(chart: ChartRecommendation): string {
    const chartType = chart.chartType.toLowerCase();
    if (chartType.includes('line')) {
      return 'bg-sky-50 text-sky-700';
    }

    if (chartType.includes('histogram')) {
      return 'bg-amber-50 text-amber-700';
    }

    if (chartType.includes('scatter')) {
      return 'bg-violet-50 text-violet-700';
    }

    return 'bg-indigo-50 text-indigo-700';
  }

  topValuesForChart(data: DashboardResponse, chart: ChartRecommendation): ValueFrequency[] {
    const xColumn = this.chartXColumn(chart);
    return data.topValueSummaries
      .find((summary) => summary.columnName.toLowerCase() === xColumn.toLowerCase())
      ?.values
      .slice(0, 4) ?? [];
  }

  numericSummaryForChart(data: DashboardResponse, chart: ChartRecommendation): NumericColumnStats | null {
    const targetColumn = this.chartYColumn(chart) && this.chartYColumn(chart) !== 'count'
      ? this.chartYColumn(chart)
      : this.chartXColumn(chart);

    return data.numericSummaries
      .find((summary) => summary.columnName.toLowerCase() === targetColumn?.toLowerCase())
      ?? null;
  }

  numericPercent(summary: NumericColumnStats, value: number): number {
    const max = Math.max(Math.abs(summary.min), Math.abs(summary.max), Math.abs(summary.average), 1);
    return Math.max(8, Math.round((Math.abs(value) / max) * 100));
  }

  chartPreviewPercent(chart: ChartRecommendation, value: number): number {
    const max = Math.max(...(chart.previewData ?? []).map((point) => Math.abs(point.value)), 1);
    return Math.max(8, Math.round((Math.abs(value) / max) * 100));
  }

  keyLikeColumns(data: DashboardResponse): string[] {
    const profileKeys = this.profile()?.keyCandidates?.map((candidate) => candidate.columnName) ?? [];
    const names = [
      ...profileKeys,
      ...data.numericSummaries.map((summary) => summary.columnName),
      ...data.topValueSummaries.map((summary) => summary.columnName),
    ];

    return Array.from(new Set(names.filter((name) => this.isKeyLikeColumn(name))));
  }

  private isCountChart(chart: ChartRecommendation): boolean {
    return chart.chartType.toLowerCase().includes('bar');
  }

  private isKeyLikeColumn(columnName: string): boolean {
    const tokens = columnName
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const keyTokens = new Set(['id', 'key', 'code', 'ref', 'no', 'num', 'number', 'uuid', 'guid']);
    if (tokens.some((token) => keyTokens.has(token))) {
      return true;
    }

    const normalized = columnName.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return normalized.length > 2
      && !normalized.endsWith('paid')
      && ['id', 'key', 'code', 'ref', 'no', 'num', 'number'].some((suffix) => normalized.endsWith(suffix));
  }
}
