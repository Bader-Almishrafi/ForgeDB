import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, finalize, map, of, Subject, switchMap, tap } from 'rxjs';
import {
  ApiConnectionTest,
  ApiJsonImportRequest,
  ApiJsonPreview,
  DatasetPreview,
  DatasetResponse,
  ExcelWorkbookPreview,
  ProjectResponse,
  ProjectWorkflowDataset,
} from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { routeParameter } from '../../services/route-context';
import { formatFileSize, isCsvFile } from '../../shared/utils/file-import.utils';

type ImportSource = 'csv' | 'excel' | 'api';

@Component({
  selector: 'app-data-sources',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  templateUrl: './data-sources.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataSourcesComponent implements OnInit {
  private readonly api = inject(ForgeApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly workflowContext = inject(ProjectWorkflowContextService);
  private readonly previewRequests = new Subject<number>();
  private queryDatasetValue: string | null = null;

  readonly project = signal<ProjectResponse | null>(null);
  readonly datasets = signal<DatasetResponse[]>([]);
  readonly selectedDatasetId = signal<number | null>(null);
  readonly projectLoading = signal(false);
  readonly datasetsLoading = signal(false);
  readonly projectError = signal('');
  readonly datasetsError = signal('');
  readonly selectionNotice = signal('');
  readonly successMessage = signal('');

  readonly preview = signal<DatasetPreview | null>(null);
  readonly previewLoading = signal(false);
  readonly previewError = signal('');

  readonly importOpen = signal(false);
  readonly importSource = signal<ImportSource>('csv');
  readonly importFile = signal<File | null>(null);
  readonly excelPreview = signal<ExcelWorkbookPreview | null>(null);
  readonly excelPreviewLoading = signal(false);
  readonly apiUrl = signal('');
  readonly apiArrayPath = signal('');
  readonly apiConnection = signal<ApiConnectionTest | null>(null);
  readonly apiPreview = signal<ApiJsonPreview | null>(null);
  readonly apiTesting = signal(false);
  readonly apiPreviewLoading = signal(false);
  readonly importing = signal(false);
  readonly importError = signal('');

  readonly replaceOpen = signal(false);
  readonly replaceFile = signal<File | null>(null);
  readonly replaceError = signal('');
  readonly replacing = signal(false);
  readonly confirmingDelete = signal(false);
  readonly deleting = signal(false);
  readonly deleteError = signal('');

  readonly editOpen = signal(false);
  readonly editName = signal('');
  readonly editDescription = signal('');
  readonly editError = signal('');
  readonly savingProject = signal(false);
  projectId = 0;

  readonly selectedDataset = computed(() => this.datasets().find((dataset) => dataset.id === this.selectedDatasetId()) ?? null);
  readonly selectedWorkflowDataset = computed(() => {
    const id = this.selectedDatasetId();
    return this.workflowContext.workflow()?.datasets.find((dataset) => dataset.datasetId === id) ?? null;
  });
  readonly projectName = computed(() => this.project()?.name ?? this.workflowContext.workflow()?.projectName ?? 'Project');
  readonly canContinueToAnalyze = computed(() => this.datasets().length > 0 && this.workflowContext.workflow()?.canAnalyze === true);
  readonly previewRows = computed(() => (this.preview()?.rows ?? []).slice(0, 20));
  readonly previewColumns = computed(() => this.preview()?.columns ?? []);
  readonly excelPreviewRows = computed(() => (this.excelPreview()?.rows ?? []).slice(0, 5));
  readonly apiPreviewRows = computed(() => (this.apiPreview()?.rows ?? []).slice(0, 5));
  readonly canImport = computed(() => {
    if (this.importing() || this.excelPreviewLoading() || this.apiTesting() || this.apiPreviewLoading()) return false;
    if (this.importSource() === 'api') return !!this.apiPreview() && !!this.apiUrl().trim();
    if (!this.importFile()) return false;
    return this.importSource() === 'csv' || !!this.excelPreview()?.selectedWorksheet;
  });

  constructor() {
    this.previewRequests.pipe(
      tap(() => {
        this.previewLoading.set(true);
        this.previewError.set('');
        this.preview.set(null);
      }),
      switchMap((datasetId) => this.api.getDatasetPreview(datasetId).pipe(
        map((preview) => ({ preview, error: '' })),
        catchError((error: unknown) => of({ preview: null, error: this.errorText(error, 'Unable to load this dataset preview.') })),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ preview, error }) => {
      this.preview.set(preview);
      this.previewError.set(error);
      this.previewLoading.set(false);
    });
  }

  ngOnInit(): void {
    this.projectId = routeParameter(this.route, 'projectId') ?? 0;
    if (this.projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.queryDatasetValue = params.get('datasetId');
      if (this.datasets().length) this.selectFromQuery();
    });
    this.workflowContext.load(this.projectId).subscribe();
    this.loadProject();
    this.loadDatasets();
  }

  loadProject(): void {
    this.projectLoading.set(true);
    this.projectError.set('');
    this.api.getProject(this.projectId).pipe(finalize(() => this.projectLoading.set(false))).subscribe({
      next: (project) => this.project.set(project),
      error: (error: unknown) => this.projectError.set(this.errorText(error, 'Unable to load project details.')),
    });
  }

  loadDatasets(preferredId?: number): void {
    this.datasetsLoading.set(true);
    this.datasetsError.set('');
    this.api.getProjectDatasets(this.projectId).pipe(finalize(() => this.datasetsLoading.set(false))).subscribe({
      next: (datasets) => {
        const ordered = [...datasets].sort((left, right) => left.id - right.id);
        this.datasets.set(ordered);
        this.restoreSelection(ordered, preferredId);
      },
      error: (error: unknown) => this.datasetsError.set(this.errorText(error, 'Unable to load datasets.')),
    });
  }

  selectDatasetById(datasetId: number): void {
    const dataset = this.datasets().find((item) => item.id === Number(datasetId));
    if (dataset) this.setSelectedDataset(dataset, false, true);
  }

  refreshPreview(): void {
    const dataset = this.selectedDataset();
    if (dataset) this.previewRequests.next(dataset.id);
  }

  openImport(source: ImportSource = 'csv'): void {
    this.resetImport();
    this.importSource.set(source);
    this.importOpen.set(true);
  }

  selectImportSource(source: ImportSource): void {
    if (this.importing() || source === this.importSource()) return;
    this.resetImport();
    this.importSource.set(source);
    this.importOpen.set(true);
  }

  closeImport(): void {
    if (this.importing()) return;
    this.resetImport();
    this.importOpen.set(false);
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.acceptImportFile(file);
  }

  onWorksheetSelected(event: Event): void {
    const worksheet = (event.target as HTMLSelectElement).value;
    if (worksheet) this.loadExcelPreview(worksheet);
  }

  importData(): void {
    if (!this.canImport()) return;
    if (this.importSource() === 'api') {
      this.importApiData();
      return;
    }

    const file = this.importFile();
    if (!file) return;
    const source = this.importSource();
    const worksheet = this.excelPreview()?.selectedWorksheet;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sourceType', source);
    formData.append('sourceName', file.name);
    if (source === 'excel' && worksheet) formData.append('worksheetName', worksheet);
    formData.append('tableName', this.importTableName(file.name, worksheet));

    this.importing.set(true);
    this.importError.set('');
    this.api.uploadDataset(this.projectId, formData).pipe(finalize(() => this.importing.set(false))).subscribe({
      next: (dataset) => this.finishImport(dataset),
      error: (error: unknown) => this.importError.set(this.errorText(error, `Unable to import this ${source === 'excel' ? 'Excel workbook' : 'CSV file'}.`)),
    });
  }

  updateApiUrl(value: string): void {
    this.apiUrl.set(value);
    this.apiConnection.set(null);
    this.apiPreview.set(null);
    this.importError.set('');
  }

  updateApiArrayPath(value: string): void {
    this.apiArrayPath.set(value);
    this.apiConnection.set(null);
    this.apiPreview.set(null);
    this.importError.set('');
  }

  testApiConnection(): void {
    if (!this.apiUrl().trim() || this.apiTesting()) return;
    this.apiTesting.set(true);
    this.importError.set('');
    this.apiConnection.set(null);
    this.api.testApiConnection(this.apiRequest()).pipe(finalize(() => this.apiTesting.set(false))).subscribe({
      next: (result) => this.apiConnection.set(result),
      error: (error: unknown) => this.importError.set(this.errorText(error, 'Unable to connect to this API.')),
    });
  }

  previewApiData(): void {
    if (!this.apiUrl().trim() || this.apiPreviewLoading()) return;
    this.apiPreviewLoading.set(true);
    this.importError.set('');
    this.apiPreview.set(null);
    this.api.previewApi(this.apiRequest()).pipe(finalize(() => this.apiPreviewLoading.set(false))).subscribe({
      next: (preview) => this.apiPreview.set(preview),
      error: (error: unknown) => this.importError.set(this.errorText(error, 'Unable to preview data from this API.')),
    });
  }

  openReplace(): void {
    this.replaceFile.set(null);
    this.replaceError.set('');
    this.replaceOpen.set(true);
  }

  closeReplace(): void {
    if (this.replacing()) return;
    this.replaceOpen.set(false);
    this.replaceFile.set(null);
    this.replaceError.set('');
  }

  onReplaceFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.replaceError.set('');
    if (!file) return;
    if (!isCsvFile(file)) {
      this.replaceFile.set(null);
      this.replaceError.set('Choose one non-empty CSV file.');
      return;
    }
    this.replaceFile.set(file);
  }

  replaceDataset(): void {
    const dataset = this.selectedDataset();
    const file = this.replaceFile();
    if (!dataset || !file || this.replacing()) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('sourceType', 'csv');
    formData.append('sourceName', file.name);
    this.replacing.set(true);
    this.replaceError.set('');
    this.api.replaceDataset(dataset.id, formData).pipe(finalize(() => this.replacing.set(false))).subscribe({
      next: (updated) => {
        this.closeReplace();
        this.successMessage.set(`${this.displayName(updated)} was replaced. Re-analysis is required; previous versions remain in history.`);
        this.loadDatasets(updated.id);
        this.refreshWorkflow();
      },
      error: (error: unknown) => this.replaceError.set(this.errorText(error, 'Unable to replace this dataset.')),
    });
  }

  requestDelete(): void {
    this.deleteError.set('');
    this.confirmingDelete.set(true);
  }

  cancelDelete(): void {
    if (!this.deleting()) this.confirmingDelete.set(false);
  }

  deleteDataset(): void {
    const dataset = this.selectedDataset();
    if (!dataset || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set('');
    this.api.deleteDataset(dataset.id).pipe(finalize(() => this.deleting.set(false))).subscribe({
      next: () => {
        this.confirmingDelete.set(false);
        this.selectedDatasetId.set(null);
        this.successMessage.set(`${this.displayName(dataset)} was deleted.`);
        this.loadDatasets();
        this.refreshWorkflow();
      },
      error: (error: unknown) => this.deleteError.set(this.errorText(error, 'Unable to delete this dataset.')),
    });
  }

  openProjectEdit(): void {
    const project = this.project();
    if (!project) return;
    this.editName.set(project.name);
    this.editDescription.set(project.description ?? '');
    this.editError.set('');
    this.editOpen.set(true);
  }

  closeProjectEdit(): void {
    if (!this.savingProject()) this.editOpen.set(false);
  }

  saveProject(): void {
    const project = this.project();
    const name = this.editName().trim();
    if (!project || !name || name.length > 100 || this.editDescription().length > 500 || this.savingProject()) return;
    this.savingProject.set(true);
    this.editError.set('');
    this.api.updateProject(project.id, { name, description: this.editDescription().trim() || null })
      .pipe(finalize(() => this.savingProject.set(false)))
      .subscribe({
        next: (updated) => {
          this.project.set(updated);
          this.editOpen.set(false);
          this.successMessage.set('Project details updated.');
          this.refreshWorkflow();
        },
        error: (error: unknown) => this.editError.set(this.errorText(error, 'Unable to update this project.')),
      });
  }

  continueToAnalyze(): void {
    if (!this.canContinueToAnalyze()) return;
    const datasetId = this.selectedDatasetId();
    void this.router.navigate(['/projects', this.projectId, 'analyze'], {
      queryParams: datasetId ? { datasetId } : {},
    });
  }

  workflowDataset(datasetId: number): ProjectWorkflowDataset | null {
    return this.workflowContext.workflow()?.datasets.find((dataset) => dataset.datasetId === datasetId) ?? null;
  }

  analysisStatus(datasetId: number): string {
    const metadata = this.workflowDataset(datasetId);
    if (!metadata) return 'Status unavailable';
    return metadata.hasCurrentAnalysis && !metadata.requiresAnalysis ? 'Analyzed' : 'Analysis required';
  }

  formatSize(bytes: number): string {
    return formatFileSize(bytes);
  }

  displayName(dataset: DatasetResponse): string {
    return dataset.sourceName || dataset.tableName;
  }

  previewValue(row: Record<string, unknown>, column: string): string {
    const value = row[column];
    return value === null || value === undefined ? 'Not available' : String(value);
  }

  private restoreSelection(datasets: DatasetResponse[], preferredId?: number): void {
    this.selectionNotice.set('');
    if (!datasets.length) {
      this.selectedDatasetId.set(null);
      this.preview.set(null);
      this.updateDatasetQuery(null, true);
      return;
    }

    const queryId = this.parseDatasetId(this.queryDatasetValue);
    const preferred = preferredId ? datasets.find((dataset) => dataset.id === preferredId) : null;
    const requested = queryId ? datasets.find((dataset) => dataset.id === queryId) : null;
    const selected = preferred ?? requested ?? datasets[0];
    if (!preferred && this.queryDatasetValue !== null && !requested) {
      this.selectionNotice.set('The selected dataset is not in this project. Showing the first available dataset.');
    }
    this.setSelectedDataset(selected, true, false);
  }

  private selectFromQuery(): void {
    const queryId = this.parseDatasetId(this.queryDatasetValue);
    const requested = queryId ? this.datasets().find((dataset) => dataset.id === queryId) : null;
    if (requested) {
      if (requested.id !== this.selectedDatasetId()) this.setSelectedDataset(requested, true, true);
      return;
    }
    const first = this.datasets()[0];
    if (!first) return;
    if (this.queryDatasetValue !== null) {
      this.selectionNotice.set('The selected dataset is not in this project. Showing the first available dataset.');
    }
    this.setSelectedDataset(first, true, false);
  }

  private setSelectedDataset(dataset: DatasetResponse, replaceUrl: boolean, clearNotice: boolean): void {
    if (clearNotice) this.selectionNotice.set('');
    const changed = this.selectedDatasetId() !== dataset.id;
    this.selectedDatasetId.set(dataset.id);
    this.updateDatasetQuery(dataset.id, replaceUrl);
    if (changed || this.preview()?.datasetId !== dataset.id) this.previewRequests.next(dataset.id);
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

  private acceptImportFile(file: File | null): void {
    this.importError.set('');
    this.importFile.set(null);
    this.excelPreview.set(null);
    if (!file) return;
    if (this.importSource() === 'csv') {
      if (!isCsvFile(file)) {
        this.importError.set('Choose one non-empty CSV file.');
        return;
      }
      this.importFile.set(file);
      return;
    }
    if (!file.name.toLocaleLowerCase().endsWith('.xlsx') || file.size <= 0) {
      this.importError.set('Choose one non-empty .xlsx Excel workbook.');
      return;
    }
    this.importFile.set(file);
    this.loadExcelPreview();
  }

  private loadExcelPreview(worksheetName?: string): void {
    const file = this.importFile();
    if (!file || this.importSource() !== 'excel') return;
    const formData = new FormData();
    formData.append('file', file);
    if (worksheetName) formData.append('worksheetName', worksheetName);
    this.excelPreviewLoading.set(true);
    this.importError.set('');
    this.api.previewExcel(formData).pipe(finalize(() => this.excelPreviewLoading.set(false))).subscribe({
      next: (preview) => this.excelPreview.set(preview),
      error: (error: unknown) => this.importError.set(this.errorText(error, 'Unable to read this Excel workbook.')),
    });
  }

  private importApiData(): void {
    this.importing.set(true);
    this.importError.set('');
    this.api.importApi(this.projectId, this.apiRequest()).pipe(finalize(() => this.importing.set(false))).subscribe({
      next: (dataset) => this.finishImport(dataset),
      error: (error: unknown) => this.importError.set(this.errorText(error, 'Unable to import data from this API.')),
    });
  }

  private finishImport(dataset: DatasetResponse): void {
    this.successMessage.set(`${this.displayName(dataset)} imported successfully.`);
    this.resetImport();
    this.importOpen.set(false);
    this.loadDatasets(dataset.id);
    this.refreshWorkflow();
  }

  private resetImport(): void {
    this.importFile.set(null);
    this.excelPreview.set(null);
    this.apiUrl.set('');
    this.apiArrayPath.set('');
    this.apiConnection.set(null);
    this.apiPreview.set(null);
    this.importError.set('');
  }

  private apiRequest(): ApiJsonImportRequest {
    return {
      apiUrl: this.apiUrl().trim(),
      arrayPath: this.apiArrayPath().trim() || null,
    };
  }

  private importTableName(fileName: string, worksheet?: string | null): string {
    const base = fileName.replace(/\.(csv|xlsx)$/i, '');
    const candidate = worksheet ? `${base}_${worksheet}` : base;
    return candidate.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'dataset';
  }

  private parseDatasetId(value: string | null): number | null {
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private refreshWorkflow(): void {
    this.workflowContext.load(this.projectId, true).subscribe();
  }

  private errorText(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }
}
