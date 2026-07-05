import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, DashboardResponse, DashboardTopValues } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NgClass, RouterLink],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  readonly dashboard = signal<DashboardResponse | null>(null);
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
  ) {}

  ngOnInit(): void {
    this.datasetId = Number(this.route.snapshot.paramMap.get('datasetId'));
    if (!Number.isFinite(this.datasetId) || this.datasetId <= 0) {
      this.router.navigate(['/projects']);
      return;
    }

    this.loadDashboard();
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
}
