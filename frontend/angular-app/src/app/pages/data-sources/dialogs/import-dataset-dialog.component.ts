import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, Output, signal, OnChanges, SimpleChanges, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, from, concatMap, toArray } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiConnectionTest, ApiJsonImportRequest, ApiJsonPreview, DatasetResponse, ExcelWorkbookPreview } from '../../../services/api.models';
import { ForgeApiService } from '../../../services/forge-api.service';
import { isCsvFile, formatFileSize } from '../../../shared/utils/file-import.utils';

type ImportSource = 'csv' | 'excel' | 'api';

@Component({
  selector: 'app-import-dataset-dialog',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './import-dataset-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportDatasetDialogComponent implements OnChanges {
  private readonly api = inject(ForgeApiService);

  @Input() isOpen = false;
  @Input() projectId = 0;
  @Input() projectName = 'Project';
  @Input() initialSource: ImportSource | null = null;
  
  @Output() closeDialog = new EventEmitter<void>();
  @Output() imported = new EventEmitter<DatasetResponse>();

  readonly importSource = signal<ImportSource | null>(null);
  readonly importFiles = signal<File[]>([]);
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

  readonly excelPreviewRows = computed(() => (this.excelPreview()?.rows ?? []).slice(0, 5));
  readonly apiPreviewRows = computed(() => (this.apiPreview()?.rows ?? []).slice(0, 5));
  
  readonly canImport = computed(() => {
    if (this.importing() || this.excelPreviewLoading() || this.apiTesting() || this.apiPreviewLoading()) return false;
    if (!this.importSource()) return false;
    if (this.importSource() === 'api') return !!this.apiPreview() && !!this.apiUrl().trim();
    if (!this.importFiles().length) return false;
    return this.importSource() === 'csv' || !!this.excelPreview()?.selectedWorksheet;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetImport();
      if (this.initialSource) {
        this.importSource.set(this.initialSource);
      }
    }
  }

  close(): void {
    if (this.importing()) return;
    this.resetImport();
    this.closeDialog.emit();
  }

  selectImportSource(source: ImportSource): void {
    if (this.importing() || source === this.importSource()) return;
    this.resetImport();
    this.importSource.set(source);
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.acceptImportFile(input.files);
    input.value = '';
  }

  removeFile(index: number): void {
    this.importFiles.update(files => files.filter((_, i) => i !== index));
    if (this.importFiles().length === 0) {
       this.excelPreview.set(null);
    }
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

    const files = this.importFiles();
    if (!files.length) return;
    const source = this.importSource();
    if (!source) return;

    this.importing.set(true);
    this.importError.set('');

    if (source === 'csv') {
      from(files).pipe(
        concatMap(file => {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('sourceType', 'csv');
          formData.append('sourceName', file.name);
          formData.append('tableName', this.importTableName(file.name));
          return this.api.uploadDataset(this.projectId, formData);
        }),
        toArray(),
        finalize(() => this.importing.set(false))
      ).subscribe({
        next: (datasets) => {
          if (datasets.length > 0) {
            this.imported.emit(datasets[datasets.length - 1]);
          }
          this.closeDialog.emit();
        },
        error: (error: unknown) => this.importError.set(this.errorText(error, 'Unable to import one or more CSV files.'))
      });
    } else {
      const file = files[0];
      const worksheet = this.excelPreview()?.selectedWorksheet;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sourceType', source);
      formData.append('sourceName', file.name);
      if (worksheet) formData.append('worksheetName', worksheet);
      formData.append('tableName', this.importTableName(file.name, worksheet));

      this.api.uploadDataset(this.projectId, formData).pipe(finalize(() => this.importing.set(false))).subscribe({
        next: (dataset) => {
          this.imported.emit(dataset);
          this.closeDialog.emit();
        },
        error: (error: unknown) => this.importError.set(this.errorText(error, 'Unable to import this Excel workbook.')),
      });
    }
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

  previewValue(row: Record<string, unknown>, column: string): string {
    const value = row[column];
    return value === null || value === undefined ? 'Not available' : String(value);
  }

  formatSize(bytes: number): string {
    return formatFileSize(bytes);
  }

  private acceptImportFile(filesList: FileList | null): void {
    this.importError.set('');
    if (!filesList || filesList.length === 0) return;
    
    if (this.importSource() === 'csv') {
      const validFiles = Array.from(filesList).filter(f => isCsvFile(f));
      if (validFiles.length === 0) {
        this.importError.set('Choose at least one non-empty CSV file.');
        return;
      }
      this.importFiles.update(current => [...current, ...validFiles]);
      return;
    }
    
    const file = filesList[0];
    if (!file.name.toLocaleLowerCase().endsWith('.xlsx') || file.size <= 0) {
      this.importError.set('Choose one non-empty .xlsx Excel workbook.');
      return;
    }
    this.importFiles.set([file]);
    this.loadExcelPreview();
  }

  private loadExcelPreview(worksheetName?: string): void {
    const files = this.importFiles();
    if (!files.length || this.importSource() !== 'excel') return;
    const file = files[0];
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
      next: (dataset) => {
        this.imported.emit(dataset);
        this.closeDialog.emit();
      },
      error: (error: unknown) => this.importError.set(this.errorText(error, 'Unable to import data from this API.')),
    });
  }

  private resetImport(): void {
    this.importSource.set(null);
    this.importFiles.set([]);
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

  private errorText(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }
}
