import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  Input,
  OnChanges,
  Output,
  signal,
  SimpleChanges,
  computed,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, concatMap, finalize, from, map, of, toArray } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiConnectionTest, ApiJsonImportRequest, ApiJsonPreview, DatasetResponse, ExcelWorkbookPreview } from '../../../services/api.models';
import { ForgeApiService } from '../../../services/forge-api.service';
import { DialogFocusTrapDirective } from '../../../shared/dialog-focus-trap.directive';
import { formatFileSize, isCsvFile, MAX_IMPORT_FILE_BYTES } from '../../../shared/utils/file-import.utils';

type ImportSource = 'csv' | 'excel' | 'api';

interface CsvImportResult {
  file: File;
  dataset: DatasetResponse | null;
  error: unknown | null;
}

interface CsvImportProgress {
  current: number;
  total: number;
  fileName: string;
}

@Component({
  selector: 'app-import-dataset-dialog',
  standalone: true,
  imports: [FormsModule, DialogFocusTrapDirective],
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
  @Output() imported = new EventEmitter<DatasetResponse[]>();

  private readonly initialFocus = viewChild<ElementRef<HTMLButtonElement>>('initialFocus');
  private previouslyFocused: HTMLElement | null = null;
  private excelPreviewRequestToken = 0;
  private apiConnectionRequestToken = 0;
  private apiPreviewRequestToken = 0;
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
  readonly csvImportProgress = signal<CsvImportProgress | null>(null);
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
      this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.resetImport();
      if (this.initialSource) {
        this.importSource.set(this.initialSource);
      }
      setTimeout(() => this.initialFocus()?.nativeElement.focus());
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) this.close();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  close(): void {
    if (this.importing()) return;
    this.finishClose();
  }

  selectImportSource(source: ImportSource): void {
    if (this.importing() || this.excelPreviewLoading() || this.apiTesting() || this.apiPreviewLoading() || source === this.importSource()) return;
    this.resetImport();
    this.importSource.set(source);
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (this.importing() || this.excelPreviewLoading()) {
      input.value = '';
      return;
    }
    this.acceptImportFile(input.files);
    input.value = '';
  }

  removeFile(index: number): void {
    if (this.importing() || this.excelPreviewLoading()) return;
    this.excelPreviewRequestToken++;
    this.importFiles.update(files => files.filter((_, i) => i !== index));
    if (this.importFiles().length === 0) {
       this.excelPreview.set(null);
    }
  }

  onWorksheetSelected(event: Event): void {
    if (this.importing() || this.excelPreviewLoading()) return;
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
    this.csvImportProgress.set(null);
    this.importError.set('');

    if (source === 'csv') {
      let fileIndex = 0;
      from(files).pipe(
        concatMap(file => {
          this.csvImportProgress.set({
            current: ++fileIndex,
            total: files.length,
            fileName: file.name,
          });
          const formData = new FormData();
          formData.append('file', file);
          formData.append('sourceType', 'csv');
          formData.append('sourceName', file.name);
          formData.append('tableName', this.importTableName(file.name));
          return this.api.uploadDataset(this.projectId, formData).pipe(
            map((dataset): CsvImportResult => ({ file, dataset, error: null })),
            catchError((error: unknown) => of<CsvImportResult>({ file, dataset: null, error })),
          );
        }),
        toArray(),
        finalize(() => {
          this.importing.set(false);
          this.csvImportProgress.set(null);
        })
      ).subscribe({
        next: (results) => {
          const datasets = results
            .map((result) => result.dataset)
            .filter((dataset): dataset is DatasetResponse => dataset !== null);
          const failed = results.filter((result) => result.error !== null);

          if (datasets.length) this.imported.emit(datasets);

          if (failed.length) {
            this.importFiles.set(failed.map((result) => result.file));
            const importedCount = datasets.length;
            const importedPrefix = importedCount
              ? `Imported ${importedCount} of ${results.length} files. `
              : '';
            this.importError.set(
              `${importedPrefix}Could not import: ${this.csvFailureDetails(failed)} Correct the listed issue(s) and try again.`,
            );
            return;
          }

          this.finishClose(false);
        },
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
          this.imported.emit([dataset]);
          this.finishClose(false);
        },
        error: (error: unknown) => this.importError.set(this.errorText(error, 'Unable to import this Excel workbook.')),
      });
    }
  }

  updateApiUrl(value: string): void {
    this.invalidateApiRequests();
    this.apiUrl.set(value);
    this.apiConnection.set(null);
    this.apiPreview.set(null);
    this.importError.set('');
  }

  updateApiArrayPath(value: string): void {
    this.invalidateApiRequests();
    this.apiArrayPath.set(value);
    this.apiConnection.set(null);
    this.apiPreview.set(null);
    this.importError.set('');
  }

  testApiConnection(): void {
    if (!this.apiUrl().trim() || this.apiTesting()) return;
    const requestToken = ++this.apiConnectionRequestToken;
    const request = this.apiRequest();
    this.apiTesting.set(true);
    this.importError.set('');
    this.apiConnection.set(null);
    this.api.testApiConnection(request).pipe(finalize(() => {
      if (requestToken === this.apiConnectionRequestToken) this.apiTesting.set(false);
    })).subscribe({
      next: (result) => {
        if (requestToken === this.apiConnectionRequestToken) this.apiConnection.set(result);
      },
      error: (error: unknown) => {
        if (requestToken === this.apiConnectionRequestToken) {
          this.importError.set(this.errorText(error, 'Unable to connect to this API.'));
        }
      },
    });
  }

  previewApiData(): void {
    if (!this.apiUrl().trim() || this.apiPreviewLoading()) return;
    const requestToken = ++this.apiPreviewRequestToken;
    const request = this.apiRequest();
    this.apiPreviewLoading.set(true);
    this.importError.set('');
    this.apiPreview.set(null);
    this.api.previewApi(request).pipe(finalize(() => {
      if (requestToken === this.apiPreviewRequestToken) this.apiPreviewLoading.set(false);
    })).subscribe({
      next: (preview) => {
        if (requestToken === this.apiPreviewRequestToken) this.apiPreview.set(preview);
      },
      error: (error: unknown) => {
        if (requestToken === this.apiPreviewRequestToken) {
          this.importError.set(this.errorText(error, 'Unable to preview data from this API.'));
        }
      },
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
      const candidates = Array.from(filesList);
      const validFiles = candidates.filter((file) => isCsvFile(file));
      if (validFiles.length === 0) {
        this.importError.set('Choose at least one non-empty CSV file no larger than 10 MB.');
        return;
      }
      const selectedNames = new Set(this.importFiles().map((file) => file.name.toLocaleLowerCase()));
      const uniqueFiles = validFiles.filter((file) => {
        const normalizedName = file.name.toLocaleLowerCase();
        if (selectedNames.has(normalizedName)) return false;
        selectedNames.add(normalizedName);
        return true;
      });
      this.importFiles.update((current) => [...current, ...uniqueFiles]);

      const skippedInvalid = candidates.length - validFiles.length;
      const skippedDuplicates = validFiles.length - uniqueFiles.length;
      const notices = [
        skippedInvalid ? `${skippedInvalid} invalid, empty, or oversized file${skippedInvalid === 1 ? '' : 's'} skipped.` : '',
        skippedDuplicates ? `${skippedDuplicates} duplicate file name${skippedDuplicates === 1 ? '' : 's'} skipped.` : '',
      ].filter(Boolean);
      if (notices.length) this.importError.set(notices.join(' '));
      return;
    }
    
    const file = filesList[0];
    if (!file.name.toLocaleLowerCase().endsWith('.xlsx') || file.size <= 0 || file.size > MAX_IMPORT_FILE_BYTES) {
      this.importError.set('Choose one non-empty .xlsx Excel workbook no larger than 10 MB.');
      return;
    }
    this.importFiles.set([file]);
    this.loadExcelPreview();
  }

  private loadExcelPreview(worksheetName?: string): void {
    const files = this.importFiles();
    if (!files.length || this.importSource() !== 'excel') return;
    const file = files[0];
    const requestToken = ++this.excelPreviewRequestToken;
    const formData = new FormData();
    formData.append('file', file);
    if (worksheetName) formData.append('worksheetName', worksheetName);
    this.excelPreviewLoading.set(true);
    this.excelPreview.set(null);
    this.importError.set('');
    this.api.previewExcel(formData).pipe(finalize(() => {
      if (requestToken === this.excelPreviewRequestToken) this.excelPreviewLoading.set(false);
    })).subscribe({
      next: (preview) => {
        if (requestToken === this.excelPreviewRequestToken && this.importFiles()[0] === file) {
          this.excelPreview.set(preview);
        }
      },
      error: (error: unknown) => {
        if (requestToken === this.excelPreviewRequestToken && this.importFiles()[0] === file) {
          this.importError.set(this.errorText(error, 'Unable to read this Excel workbook.'));
        }
      },
    });
  }

  private importApiData(): void {
    this.importing.set(true);
    this.importError.set('');
    this.api.importApi(this.projectId, this.apiRequest()).pipe(finalize(() => this.importing.set(false))).subscribe({
      next: (dataset) => {
        this.imported.emit([dataset]);
        this.finishClose(false);
      },
      error: (error: unknown) => this.importError.set(this.errorText(error, 'Unable to import data from this API.')),
    });
  }

  private resetImport(): void {
    this.excelPreviewRequestToken++;
    this.invalidateApiRequests();
    this.excelPreviewLoading.set(false);
    this.importSource.set(null);
    this.importFiles.set([]);
    this.excelPreview.set(null);
    this.apiUrl.set('');
    this.apiArrayPath.set('');
    this.apiConnection.set(null);
    this.apiPreview.set(null);
    this.csvImportProgress.set(null);
    this.importError.set('');
  }

  private invalidateApiRequests(): void {
    this.apiConnectionRequestToken++;
    this.apiPreviewRequestToken++;
    this.apiTesting.set(false);
    this.apiPreviewLoading.set(false);
  }

  private finishClose(restoreFocus = true): void {
    this.resetImport();
    this.closeDialog.emit();
    const focusTarget = this.previouslyFocused;
    this.previouslyFocused = null;
    if (restoreFocus) setTimeout(() => focusTarget?.focus());
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

  private csvFailureDetails(failed: CsvImportResult[]): string {
    const grouped = new Map<string, string[]>();
    for (const result of failed) {
      const reason = this.errorText(result.error, 'The server rejected this file.')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
      const names = grouped.get(reason) ?? [];
      if (!names.includes(result.file.name)) names.push(result.file.name);
      grouped.set(reason, names);
    }

    const groups = Array.from(grouped.entries());
    const visible = groups.slice(0, 4).map(([reason, names]) => {
      const visibleNames = names.slice(0, 3);
      const omittedNames = names.length - visibleNames.length;
      const normalizedReason = reason.replace(/[.;:]+$/g, '');
      return `${visibleNames.join(', ')}${omittedNames ? ` (+${omittedNames} more)` : ''}: ${normalizedReason}.`;
    });
    const omittedGroups = groups.length - visible.length;
    return `${visible.join(' ')}${omittedGroups ? ` ${omittedGroups} additional error type(s) omitted.` : ''}`;
  }

  private errorText(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (typeof error.error === 'string' && error.error.trim()) return error.error;
      if (error.error && typeof error.error === 'object') {
        const body = error.error as { message?: unknown; detail?: unknown };
        const message = typeof body.message === 'string' && body.message.trim()
          ? body.message
          : body.detail;
        if (typeof message === 'string' && message.trim()) return message;
      }
    }
    return fallback;
  }
}
