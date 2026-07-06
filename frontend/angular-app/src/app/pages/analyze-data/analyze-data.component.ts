import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, DatasetAnalysisResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-analyze-data',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './analyze-data.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyzeDataComponent implements OnInit {
  readonly analysis = signal<DatasetAnalysisResponse | null>(null);
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

    this.workflow.setDatasetId(this.datasetId);
    this.loadAnalysis();
  }

  loadAnalysis(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getDatasetAnalysis(this.datasetId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (analysis) => {
          this.analysis.set(analysis);
          this.workflow.setDatasetId(analysis.datasetId, analysis.tableName, analysis.status);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load saved analysis.';
        },
      });
  }

  runAnalysis(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.analyzing.set(true);

    this.api.analyzeDataset(this.datasetId, { analysisType: 'profile' })
      .pipe(finalize(() => this.analyzing.set(false)))
      .subscribe({
        next: (analysis) => {
          this.analysis.set(analysis);
          this.workflow.setDatasetId(analysis.datasetId, analysis.tableName, analysis.status);
          this.successMessage = 'Analysis completed successfully.';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Analysis failed. The backend may be unavailable.';
        },
      });
  }
}
