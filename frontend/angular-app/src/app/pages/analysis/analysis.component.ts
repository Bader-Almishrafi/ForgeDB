import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, DatasetPreview } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './analysis.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisComponent implements OnInit {
  readonly preview = signal<DatasetPreview | null>(null);
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

    this.loadPreview();
  }

  loadPreview(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getDatasetPreview(this.datasetId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          this.workflow.setDatasetId(preview.datasetId, preview.tableName);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load dataset preview.';
        },
      });
  }

  analyze(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.analyzing.set(true);

    this.api.analyzeDataset(this.datasetId, { analysisType: 'profile' })
      .pipe(finalize(() => this.analyzing.set(false)))
      .subscribe({
        next: () => {
          this.workflow.setDatasetId(this.datasetId, this.preview()?.tableName, 'Analyzed');
          this.successMessage = 'Analysis completed. Dashboard data is ready.';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to analyze dataset.';
        },
      });
  }

  cellValue(row: Record<string, unknown>, column: string): string {
    const value = row[column];
    if (value === null || value === undefined || value === '') {
      return '-';
    }

    return String(value);
  }
}
