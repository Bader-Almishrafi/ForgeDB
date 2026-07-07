import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, DatasetResponse, ProjectResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-data-sources',
  standalone: true,
  imports: [FormsModule, NgClass, RouterLink],
  templateUrl: './data-sources.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataSourcesComponent implements OnInit {
  readonly project = signal<ProjectResponse | null>(null);
  readonly datasets = signal<DatasetResponse[]>([]);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly analyzingDatasetId = signal<number | null>(null);
  readonly uploadedDataset = signal<DatasetResponse | null>(null);

  projectId = 0;
  selectedFile: File | null = null;
  selectedFileName = '';
  tableName = '';
  errorMessage = '';
  successMessage = '';

  constructor(
    private api: ForgeApiService,
    private route: ActivatedRoute,
    private router: Router,
    private workflow: WorkflowStateService,
  ) {}

  ngOnInit(): void {
    this.projectId = Number(this.route.snapshot.paramMap.get('projectId'));
    if (!Number.isFinite(this.projectId) || this.projectId <= 0) {
      this.router.navigate(['/projects']);
      return;
    }

    this.loadProject();
    this.loadDatasets();
  }

  loadProject(): void {
    this.api.getProject(this.projectId).subscribe({
      next: (project) => {
        this.project.set(project);
        this.workflow.setProject(project);
      },
      error: () => this.project.set(null),
    });
  }

  loadDatasets(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getProjectDatasets(this.projectId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (datasets) => this.datasets.set(datasets),
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load datasets.';
        },
      });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    this.selectedFileName = this.selectedFile?.name ?? '';

    if (!this.tableName && this.selectedFileName) {
      this.tableName = this.selectedFileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]+/g, '_');
    }
  }

  uploadCsv(): void {
    if (!this.selectedFile) {
      this.errorMessage = 'Choose a CSV file before uploading.';
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.uploading.set(true);

    const formData = new FormData();
    formData.append('file', this.selectedFile);
    formData.append('sourceType', 'csv');
    formData.append('sourceName', this.selectedFile.name);
    formData.append('tableName', this.tableName || this.selectedFile.name.replace(/\.[^.]+$/, ''));

    this.api.uploadDataset(this.projectId, formData)
      .pipe(finalize(() => this.uploading.set(false)))
      .subscribe({
        next: (dataset) => {
          this.selectedFile = null;
          this.selectedFileName = '';
          this.tableName = '';
          this.successMessage = `Uploaded ${dataset.tableName}.`;
          this.uploadedDataset.set(dataset);
          this.workflow.setDataset(dataset);
          this.datasets.update((datasets) => [dataset, ...datasets]);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to upload dataset.';
        },
      });
  }

  analyzeDataset(dataset: DatasetResponse): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.analyzingDatasetId.set(dataset.id);

    this.api.analyzeDataset(dataset.id, { analysisType: 'profile' })
      .pipe(finalize(() => this.analyzingDatasetId.set(null)))
      .subscribe({
        next: (analysis) => {
          this.successMessage = `${analysis.tableName} analyzed successfully.`;
          this.workflow.setDatasetId(analysis.datasetId, analysis.tableName, analysis.status);
          this.loadDatasets();
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to analyze dataset.';
        },
      });
  }

  analyzedCount(): number {
    return this.datasets().filter((dataset) => dataset.status === 'Analyzed').length;
  }

  totalRows(): number {
    return this.datasets().reduce((total, dataset) => total + dataset.rowCount, 0);
  }

  totalMissingValues(): number {
    return this.datasets().reduce((total, dataset) => total + dataset.missingValuesCount, 0);
  }

  totalDuplicateRows(): number {
    return this.datasets().reduce((total, dataset) => total + dataset.duplicateRowsCount, 0);
  }

  qualitySignalClass(dataset: DatasetResponse): string {
    if (dataset.missingValuesCount > 0 || dataset.duplicateRowsCount > 0) {
      return 'text-amber-700';
    }

    return 'text-emerald-700';
  }
}
