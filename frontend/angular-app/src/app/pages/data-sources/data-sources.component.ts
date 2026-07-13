import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, map, of, Subject, switchMap, tap } from 'rxjs';
import { ApiConnectionTest, ApiJsonImportRequest, ApiJsonPreview, DatasetAnalysisResponse, DatasetPreview, DatasetResponse, ExcelWorkbookPreview, ProjectResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { formatFileSize, isCsvFile } from '../project-create/project-create.utils';

type WorkspaceMode = 'selected' | 'all';
type DatasetTab = 'overview' | 'preview' | 'quality';
type UploadSource = 'csv' | 'excel' | 'api';

interface QualityIssue {
  type: string;
  column?: string;
  description: string;
  count: number;
  severity: 'Warning' | 'Needs Attention';
}

@Component({
  selector: 'app-data-sources',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, NgClass, RouterLink],
  templateUrl: './data-sources.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataSourcesComponent implements OnInit {
  private readonly api = inject(ForgeApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly workflow = inject(WorkflowStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly previewRequests = new Subject<number>();
  private readonly analysisRequests = new Subject<number>();

  readonly project = signal<ProjectResponse | null>(null);
  readonly datasets = signal<DatasetResponse[]>([]);
  readonly selectedDatasetId = signal<number | null>(null);
  readonly projectLoading = signal(false);
  readonly datasetsLoading = signal(false);
  readonly projectError = signal('');
  readonly datasetsError = signal('');
  readonly selectionNotice = signal('');
  readonly search = signal('');
  readonly mode = signal<WorkspaceMode>('selected');
  readonly activeTab = signal<DatasetTab>('overview');
  readonly preview = signal<DatasetPreview | null>(null);
  readonly previewLoading = signal(false);
  readonly previewError = signal('');
  readonly analysis = signal<DatasetAnalysisResponse | null>(null);
  readonly qualityLoading = signal(false);
  readonly qualityError = signal('');
  readonly uploadOpen = signal(false);
  readonly uploadSource = signal<UploadSource>('csv');
  readonly uploadFile = signal<File | null>(null);
  readonly excelPreview = signal<ExcelWorkbookPreview | null>(null);
  readonly excelPreviewLoading = signal(false);
  readonly apiUrl = signal('');
  readonly apiArrayPath = signal('');
  readonly apiConnection = signal<ApiConnectionTest | null>(null);
  readonly apiPreview = signal<ApiJsonPreview | null>(null);
  readonly apiTesting = signal(false);
  readonly apiPreviewLoading = signal(false);
  readonly uploadError = signal('');
  readonly uploadSuccess = signal('');
  readonly uploading = signal(false);
  readonly dragActive = signal(false);
  readonly replaceOpen = signal(false);
  readonly replaceFile = signal<File | null>(null);
  readonly replaceError = signal('');
  readonly replacing = signal(false);
  readonly confirmingDeleteDataset = signal(false);
  readonly deletingDataset = signal(false);
  readonly deleteError = signal('');
  projectId = 0;

  readonly selectedDataset = computed(() => this.datasets().find((dataset) => dataset.id === this.selectedDatasetId()) ?? null);
  readonly selectedIndex = computed(() => this.datasets().findIndex((dataset) => dataset.id === this.selectedDatasetId()));
  readonly filteredDatasets = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return query
      ? this.datasets().filter((dataset) => `${dataset.tableName} ${dataset.sourceName ?? ''}`.toLocaleLowerCase().includes(query))
      : this.datasets();
  });
  readonly analyzedCount = computed(() => this.datasets().filter((dataset) => this.isAnalyzed(dataset)).length);
  readonly totalRows = computed(() => this.datasets().reduce((sum, dataset) => sum + dataset.rowCount, 0));
  readonly totalColumns = computed(() => this.datasets().reduce((sum, dataset) => sum + dataset.columnCount, 0));
  readonly previewRows = computed(() => (this.preview()?.rows ?? []).slice(0, 10));
  readonly previewColumns = computed(() => this.preview()?.columns ?? []);
  readonly canImportUpload = computed(() => {
    if (this.uploading() || this.excelPreviewLoading() || this.apiTesting() || this.apiPreviewLoading()) return false;
    if (this.uploadSource() === 'api') return !!this.apiPreview() && this.apiUrl().trim().length > 0;
    if (!this.uploadFile()) return false;
    return this.uploadSource() === 'csv' || !!this.excelPreview()?.selectedWorksheet;
  });
  readonly qualityIssues = computed<QualityIssue[]>(() => {
    const result = this.analysis()?.analysisResult;
    if (!result) return [];

    const issues: QualityIssue[] = result.columns
      .filter((column) => column.missingValuesCount > 0)
      .map((column) => ({
        type: 'Missing values',
        column: column.columnName,
        description: `${column.columnName} contains missing values.`,
        count: column.missingValuesCount,
        severity: 'Needs Attention',
      }));

    if (result.duplicateRowsCount > 0) {
      issues.unshift({
        type: 'Duplicate rows',
        description: 'The analysis detected duplicate records.',
        count: result.duplicateRowsCount,
        severity: 'Warning',
      });
    }

    return issues;
  });

  constructor() {
    this.previewRequests.pipe(
      tap(() => {
        this.previewLoading.set(true);
        this.previewError.set('');
        this.preview.set(null);
      }),
      switchMap((id) => this.api.getDatasetPreview(id).pipe(
        map((preview) => ({ preview, error: '' })),
        catchError((error: unknown) => of({ preview: null, error: this.errorMessage(error, 'Data preview is not available for this dataset.') })),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ preview, error }) => {
      this.preview.set(preview);
      this.previewError.set(error);
      this.previewLoading.set(false);
    });

    this.analysisRequests.pipe(
      tap(() => {
        this.qualityLoading.set(true);
        this.qualityError.set('');
        this.analysis.set(null);
      }),
      switchMap((id) => this.api.getDatasetAnalysis(id).pipe(
        map((analysis) => ({ analysis, error: '' })),
        catchError((error: unknown) => of({ analysis: null, error: this.errorMessage(error, 'Analysis results could not be loaded.') })),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ analysis, error }) => {
      this.analysis.set(analysis);
      this.qualityError.set(error);
      this.qualityLoading.set(false);
    });
  }

  ngOnInit(): void {
    this.projectId = Number(this.route.snapshot.paramMap.get('projectId'));
    if (!Number.isFinite(this.projectId) || this.projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }

    this.workflow.setProjectId(this.projectId);
    this.loadProject();
    this.loadDatasets();
  }

  loadProject(): void {
    this.projectLoading.set(true);
    this.projectError.set('');
    this.api.getProject(this.projectId).pipe(finalize(() => this.projectLoading.set(false))).subscribe({
      next: (project) => {
        this.project.set(project);
        this.workflow.setProject(project);
      },
      error: (error: unknown) => this.projectError.set(
        error instanceof HttpErrorResponse && error.status === 404 ? 'Project not found.' : this.errorMessage(error, 'Unable to load project.'),
      ),
    });
  }

  loadDatasets(preferredId?: number): void {
    this.datasetsLoading.set(true);
    this.datasetsError.set('');
    this.api.getProjectDatasets(this.projectId).pipe(finalize(() => this.datasetsLoading.set(false))).subscribe({
      next: (datasets) => {
        this.datasets.set(datasets);
        this.restoreSelection(datasets, preferredId);
      },
      error: (error: unknown) => this.datasetsError.set(this.errorMessage(error, 'Unable to load datasets.')),
    });
  }

  selectDataset(dataset: DatasetResponse): void {
    if (!this.datasets().some((item) => item.id === dataset.id)) return;

    this.selectedDatasetId.set(dataset.id);
    this.workflow.setDataset(dataset);
    this.preview.set(null);
    this.previewError.set('');
    this.analysis.set(null);
    this.qualityError.set('');
    this.mode.set('selected');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { datasetId: dataset.id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.previewRequests.next(dataset.id);
    if (this.isAnalyzed(dataset)) this.analysisRequests.next(dataset.id);
  }

  previousDataset(): void {
    const index = this.selectedIndex();
    if (index > 0) this.selectDataset(this.datasets()[index - 1]);
  }

  nextDataset(): void {
    const index = this.selectedIndex();
    if (index >= 0 && index < this.datasets().length - 1) this.selectDataset(this.datasets()[index + 1]);
  }

  updateSearch(value: string): void {
    this.search.set(value);
  }

  showAllFiles(): void {
    this.mode.set('all');
  }

  showSelectedDataset(): void {
    this.mode.set('selected');
  }

  selectTab(tab: DatasetTab): void {
    this.activeTab.set(tab);
    this.loadActiveTab();
  }

  openUpload(): void {
    this.uploadError.set('');
    this.uploadSuccess.set('');
    this.uploadOpen.set(true);
  }

  selectUploadSource(source: UploadSource): void {
    if (this.uploading() || this.excelPreviewLoading() || this.apiTesting() || this.apiPreviewLoading() || this.uploadSource() === source) return;
    this.uploadSource.set(source);
    this.uploadFile.set(null);
    this.excelPreview.set(null);
    this.apiConnection.set(null);
    this.apiPreview.set(null);
    this.apiUrl.set('');
    this.apiArrayPath.set('');
    this.uploadError.set('');
    this.dragActive.set(false);
  }

  openReplace(): void {
    this.replaceError.set('');
    this.replaceFile.set(null);
    this.replaceOpen.set(true);
  }

  cancelReplace(): void {
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
    if (!file.name.toLocaleLowerCase().endsWith('.csv') || !isCsvFile(file)) {
      this.replaceError.set('Only a non-empty CSV file is supported.');
      return;
    }
    this.replaceFile.set(file);
  }

  replaceDataset(): void {
    const dataset = this.selectedDataset();
    const file = this.replaceFile();
    if (!dataset || !file || this.replacing()) return;

    this.replacing.set(true);
    this.replaceError.set('');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sourceType', 'csv');
    formData.append('sourceName', file.name);

    this.api.replaceDataset(dataset.id, formData).pipe(finalize(() => this.replacing.set(false))).subscribe({
      next: (updated) => {
        this.replaceOpen.set(false);
        this.replaceFile.set(null);
        this.uploadSuccess.set(`${this.displayName(updated)} was replaced successfully. Re-analyze to refresh quality metrics.`);
        this.loadDatasets(updated.id);
      },
      error: (error: unknown) => this.replaceError.set(this.errorMessage(error, 'Unable to replace this dataset.')),
    });
  }

  confirmDeleteDataset(): void {
    this.deleteError.set('');
    this.confirmingDeleteDataset.set(true);
  }

  cancelDeleteDataset(): void {
    this.confirmingDeleteDataset.set(false);
  }

  deleteDataset(): void {
    const dataset = this.selectedDataset();
    if (!dataset || this.deletingDataset()) return;

    this.deletingDataset.set(true);
    this.deleteError.set('');
    this.api.deleteDataset(dataset.id).pipe(finalize(() => this.deletingDataset.set(false))).subscribe({
      next: () => {
        this.confirmingDeleteDataset.set(false);
        this.uploadSuccess.set(`${this.displayName(dataset)} was deleted.`);
        this.loadDatasets();
      },
      error: (error: unknown) => {
        this.confirmingDeleteDataset.set(false);
        this.deleteError.set(this.errorMessage(error, 'Unable to delete this dataset.'));
      },
    });
  }

  refreshPreview(): void {
    const dataset = this.selectedDataset();
    if (dataset) this.previewRequests.next(dataset.id);
  }

  refreshQuality(): void {
    const dataset = this.selectedDataset();
    if (dataset && this.isAnalyzed(dataset)) this.analysisRequests.next(dataset.id);
  }

  analyze(): void {
    const dataset = this.selectedDataset();
    if (!dataset) return;

    this.workflow.setDataset(dataset);
    void this.router.navigate(['/datasets', dataset.id, 'analyze'], {
      queryParams: { returnProject: this.projectId, returnTo: 'data-sources' },
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.acceptFile(input.files?.[0] ?? null);
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.uploading()) this.dragActive.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
    if (this.uploading()) return;
    if (this.uploadSource() === 'api') {
      this.uploadError.set('API imports use the URL fields instead of a local file.');
      return;
    }

    const files = event.dataTransfer?.files;
    if (files && files.length > 1) {
      this.uploadFile.set(null);
      this.uploadError.set('Upload one file at a time.');
      return;
    }

    this.acceptFile(files?.[0] ?? null);
  }

  clearUpload(): void {
    if (this.uploading() || this.apiTesting() || this.apiPreviewLoading()) return;
    this.uploadFile.set(null);
    this.excelPreview.set(null);
    this.apiConnection.set(null);
    this.apiPreview.set(null);
    this.apiUrl.set('');
    this.apiArrayPath.set('');
    this.uploadError.set('');
    this.uploadOpen.set(false);
  }

  formatSize(bytes: number): string {
    return formatFileSize(bytes);
  }

  displayName(dataset: DatasetResponse): string {
    return dataset.sourceName || dataset.tableName;
  }

  isAnalyzed(dataset: DatasetResponse): boolean {
    return dataset.status.toLocaleLowerCase() === 'analyzed';
  }

  hasDatasetIssues(dataset: DatasetResponse): boolean {
    return dataset.missingValuesCount > 0 || dataset.duplicateRowsCount > 0;
  }

  statusClass(dataset: DatasetResponse): string {
    return this.isAnalyzed(dataset) ? 'badge-success' : 'badge-warning';
  }

  issueSeverityClass(issue: QualityIssue): string {
    return issue.severity === 'Needs Attention' ? 'badge-warning' : 'badge-neutral';
  }

  importUpload(): void {
    if (this.uploadSource() === 'api') {
      this.importApiDataset();
      return;
    }
    const file = this.uploadFile();
    if (!file || !this.canImportUpload()) return;

    this.uploading.set(true);
    this.uploadError.set('');
    this.uploadSuccess.set('');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sourceType', this.uploadSource());
    formData.append('sourceName', file.name);
    const worksheet = this.excelPreview()?.selectedWorksheet;
    if (this.uploadSource() === 'excel' && worksheet) formData.append('worksheetName', worksheet);
    const baseName = file.name.replace(/\.(csv|xlsx)$/i, '');
    const tableName = this.uploadSource() === 'excel' && worksheet ? `${baseName}_${worksheet}` : baseName;
    formData.append('tableName', tableName.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'dataset');

    this.api.uploadDataset(this.projectId, formData).pipe(finalize(() => this.uploading.set(false))).subscribe({
      next: (dataset) => {
        this.uploadSuccess.set(`${dataset.sourceName || dataset.tableName} imported successfully.`);
        this.uploadFile.set(null);
        this.excelPreview.set(null);
        this.uploadOpen.set(false);
        this.workflow.setDataset(dataset);
        this.loadDatasets(dataset.id);
      },
      error: (error: unknown) => this.uploadError.set(this.errorMessage(error, `Unable to import the ${this.uploadSource() === 'excel' ? 'Excel workbook' : 'CSV file'}.`)),
    });
  }

  onWorksheetSelected(event: Event): void {
    const worksheet = (event.target as HTMLSelectElement).value;
    if (worksheet) this.loadExcelPreview(worksheet);
  }

  updateApiUrl(value: string): void {
    this.apiUrl.set(value);
    this.apiConnection.set(null);
    this.apiPreview.set(null);
    this.uploadError.set('');
  }

  updateApiArrayPath(value: string): void {
    this.apiArrayPath.set(value);
    this.apiConnection.set(null);
    this.apiPreview.set(null);
    this.uploadError.set('');
  }

  testApiConnection(): void {
    if (!this.apiUrl().trim() || this.apiTesting()) return;
    this.apiTesting.set(true);
    this.uploadError.set('');
    this.apiConnection.set(null);
    this.api.testApiConnection(this.apiRequest()).pipe(finalize(() => this.apiTesting.set(false))).subscribe({
      next: (result) => this.apiConnection.set(result),
      error: (error: unknown) => this.uploadError.set(this.errorMessage(error, 'Unable to connect to this API.')),
    });
  }

  previewApiData(): void {
    if (!this.apiUrl().trim() || this.apiPreviewLoading()) return;
    this.apiPreviewLoading.set(true);
    this.uploadError.set('');
    this.apiPreview.set(null);
    this.api.previewApi(this.apiRequest()).pipe(finalize(() => this.apiPreviewLoading.set(false))).subscribe({
      next: (result) => this.apiPreview.set(result),
      error: (error: unknown) => this.uploadError.set(this.errorMessage(error, 'Unable to preview data from this API.')),
    });
  }

  previewValue(row: Record<string, unknown>, column: string): string {
    const value = row[column];
    return value === null || value === undefined ? 'Not available' : String(value);
  }

  nullPercentage(): number | null {
    const result = this.analysis()?.analysisResult;
    if (!result || result.rowCount <= 0 || result.columnCount <= 0) return null;
    return (result.missingValuesCount / (result.rowCount * result.columnCount)) * 100;
  }

  issuePercentage(issue: QualityIssue): number | null {
    const rowCount = this.analysis()?.analysisResult.rowCount;
    if (!rowCount || rowCount <= 0) return null;
    return (issue.count / rowCount) * 100;
  }

  private acceptFile(file: File | null): void {
    this.uploadError.set('');
    if (!file) return;
    const extension = this.uploadSource() === 'excel' ? '.xlsx' : '.csv';
    if (!file.name.toLocaleLowerCase().endsWith(extension)) {
      this.uploadFile.set(null);
      this.excelPreview.set(null);
      this.uploadError.set(this.uploadSource() === 'excel' ? 'Only .xlsx Excel workbooks are supported.' : 'Only CSV files are supported.');
      return;
    }
    if (file.size <= 0 || (this.uploadSource() === 'csv' && !isCsvFile(file))) {
      this.uploadFile.set(null);
      this.excelPreview.set(null);
      this.uploadError.set(`Empty ${this.uploadSource() === 'excel' ? 'Excel workbooks' : 'CSV files'} cannot be uploaded.`);
      return;
    }
    this.uploadFile.set(file);
    this.excelPreview.set(null);
    if (this.uploadSource() === 'excel') this.loadExcelPreview();
  }

  private loadExcelPreview(worksheetName?: string): void {
    const file = this.uploadFile();
    if (!file || this.uploadSource() !== 'excel') return;
    this.excelPreviewLoading.set(true);
    this.uploadError.set('');
    const formData = new FormData();
    formData.append('file', file);
    if (worksheetName) formData.append('worksheetName', worksheetName);
    this.api.previewExcel(formData).pipe(finalize(() => this.excelPreviewLoading.set(false))).subscribe({
      next: (preview) => this.excelPreview.set(preview),
      error: (error: unknown) => {
        this.excelPreview.set(null);
        this.uploadError.set(this.errorMessage(error, 'Unable to read this Excel workbook.'));
      },
    });
  }

  private importApiDataset(): void {
    if (!this.canImportUpload()) return;
    this.uploading.set(true);
    this.uploadError.set('');
    this.uploadSuccess.set('');
    this.api.importApi(this.projectId, this.apiRequest()).pipe(finalize(() => this.uploading.set(false))).subscribe({
      next: (dataset) => {
        this.uploadSuccess.set(`${dataset.sourceName || dataset.tableName} imported successfully.`);
        this.uploadOpen.set(false);
        this.apiConnection.set(null);
        this.apiPreview.set(null);
        this.apiUrl.set('');
        this.apiArrayPath.set('');
        this.workflow.setDataset(dataset);
        this.loadDatasets(dataset.id);
      },
      error: (error: unknown) => this.uploadError.set(this.errorMessage(error, 'Unable to import data from this API.')),
    });
  }

  private apiRequest(): ApiJsonImportRequest {
    const arrayPath = this.apiArrayPath().trim();
    return { apiUrl: this.apiUrl().trim(), arrayPath: arrayPath || null };
  }

  private restoreSelection(datasets: DatasetResponse[], preferredId?: number): void {
    this.selectionNotice.set('');
    if (datasets.length === 0) {
      this.selectedDatasetId.set(null);
      this.workflow.clearDataset();
      this.preview.set(null);
      this.analysis.set(null);
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { datasetId: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      return;
    }

    const rawQueryId = this.route.snapshot.queryParamMap.get('datasetId');
    const queryId = rawQueryId ? Number(rawQueryId) : undefined;
    const requestedId = Number.isFinite(queryId) && queryId && queryId > 0 ? queryId : undefined;
    const ids = [preferredId, requestedId, this.selectedDatasetId(), this.workflow.datasetId()];
    const selectedId = ids.find((id) => datasets.some((dataset) => dataset.id === id));
    const selected = datasets.find((dataset) => dataset.id === selectedId) ?? datasets[0];

    if (preferredId === undefined && requestedId && !datasets.some((dataset) => dataset.id === requestedId)) {
      this.selectionNotice.set(`Dataset ${requestedId} is not available in this project. Showing ${selected.tableName}.`);
    }

    this.selectDataset(selected);
  }

  private loadActiveTab(): void {
    const dataset = this.selectedDataset();
    if (!dataset) return;
    if (this.activeTab() === 'preview') this.previewRequests.next(dataset.id);
    if (this.activeTab() === 'quality' && this.isAnalyzed(dataset)) this.analysisRequests.next(dataset.id);
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }
}
