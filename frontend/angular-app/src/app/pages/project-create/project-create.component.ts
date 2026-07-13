import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, Subject, catchError, concatMap, from, map, of, switchMap, take, tap, toArray } from 'rxjs';
import { DatasetResponse, ExcelWorkbookPreview, ProjectResponse } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { UnsavedChangesAware } from '../../services/unsaved-changes.guard';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { fileFingerprint, formatFileSize, isCsvFile, selectedIndexAfterRemoval } from './project-create.utils';

type WizardStep = 1 | 2 | 3;
type SubmissionState = 'idle' | 'creating' | 'uploading' | 'partial' | 'success';
type FileUploadState = 'selected' | 'uploading' | 'uploaded' | 'failed';
type FeedbackKind = 'success' | 'warning' | 'error';
type WizardSource = 'csv' | 'excel';

interface WizardCsvFile {
  id: string;
  file: File;
  state: FileUploadState;
  error?: string;
  dataset?: DatasetResponse;
}

interface WizardExcelFile {
  id: string;
  file: File;
  preview: ExcelWorkbookPreview | null;
  state: FileUploadState;
  error?: string;
  dataset?: DatasetResponse;
}

interface UploadResult {
  fileId: string;
  success: boolean;
  dataset?: DatasetResponse;
  error?: string;
}

interface FeedbackMessage {
  kind: FeedbackKind;
  title: string;
  message: string;
}

const trimmedRequired: ValidatorFn = (control: AbstractControl<string>): ValidationErrors | null => {
  return control.value.trim().length > 0 ? null : { whitespace: true };
};

@Component({
  selector: 'app-project-create',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './project-create.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCreateComponent implements UnsavedChangesAware {
  private readonly formBuilder = inject(FormBuilder);
  private readonly api = inject(ForgeApiService);
  private readonly auth = inject(AuthService);
  private readonly workflow = inject(WorkflowStateService);
  private readonly router = inject(Router);
  private fileSequence = 0;
  private allowNavigation = false;
  private leaveDecision: Subject<boolean> | null = null;

  readonly stayButton = viewChild<ElementRef<HTMLButtonElement>>('stayButton');
  readonly leaveButton = viewChild<ElementRef<HTMLButtonElement>>('leaveButton');
  readonly currentStep = signal<WizardStep>(1);
  readonly selectedSource = signal<WizardSource>('csv');
  readonly csvFiles = signal<WizardCsvFile[]>([]);
  readonly excelFile = signal<WizardExcelFile | null>(null);
  readonly excelPreviewLoading = signal(false);
  readonly selectedFileIndex = signal(-1);
  readonly dragActive = signal(false);
  readonly submissionState = signal<SubmissionState>('idle');
  readonly createdProject = signal<ProjectResponse | null>(null);
  readonly uploadCompleted = signal(0);
  readonly uploadTotal = signal(0);
  readonly feedback = signal<FeedbackMessage | null>(null);
  readonly leaveDialogOpen = signal(false);

  readonly projectForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100), trimmedRequired]],
    description: ['', [Validators.maxLength(500)]],
  });
  private readonly formValue = toSignal(
    this.projectForm.valueChanges.pipe(map((value) => ({
      name: value.name ?? '',
      description: value.description ?? '',
    }))),
    { initialValue: this.projectForm.getRawValue() },
  );

  readonly steps = [
    { number: 1 as const, label: 'Project Details', shortLabel: 'Details' },
    { number: 2 as const, label: 'Data Source', shortLabel: 'Source' },
    { number: 3 as const, label: 'Review & Create', shortLabel: 'Review' },
  ];
  readonly processing = computed(() => this.submissionState() === 'creating' || this.submissionState() === 'uploading');
  readonly nameLength = computed(() => this.formValue().name.length);
  readonly descriptionLength = computed(() => this.formValue().description.length);
  readonly projectDetailsValid = computed(() => {
    this.formValue();
    return this.projectForm.valid;
  });
  readonly showNameError = computed(() => {
    this.formValue();
    const control = this.projectForm.controls.name;
    return control.invalid && (control.dirty || control.touched);
  });
  readonly currentFile = computed(() => {
    const index = this.selectedFileIndex();
    return index >= 0 ? this.csvFiles()[index] ?? null : null;
  });
  readonly uploadedFiles = computed(() => this.csvFiles().filter((item) => item.state === 'uploaded'));
  readonly failedFiles = computed(() => this.csvFiles().filter((item) => item.state === 'failed'));
  readonly sourceReady = computed(() => this.selectedSource() === 'csv'
    ? this.csvFiles().length > 0
    : !!this.excelFile()?.preview?.selectedWorksheet);
  readonly uploadedCount = computed(() => this.selectedSource() === 'csv'
    ? this.uploadedFiles().length
    : this.excelFile()?.state === 'uploaded' ? 1 : 0);
  readonly failedCount = computed(() => this.selectedSource() === 'csv'
    ? this.failedFiles().length
    : this.excelFile()?.state === 'failed' ? 1 : 0);
  readonly hasUnsavedChanges = computed(() => {
    const value = this.formValue();
    return value.name.length > 0
      || value.description.length > 0
      || this.currentStep() !== 1
      || this.csvFiles().length > 0
      || !!this.excelFile();
  });

  constructor() {
    effect(() => {
      if (this.leaveDialogOpen()) {
        queueMicrotask(() => this.stayButton()?.nativeElement.focus());
      }
    });
  }

  nextStep(): void {
    this.feedback.set(null);
    if (this.currentStep() === 1) {
      this.projectForm.markAllAsTouched();
      if (!this.projectForm.valid) {
        return;
      }
      this.currentStep.set(2);
      return;
    }

    if (this.currentStep() === 2) {
      if (!this.sourceReady()) {
        this.feedback.set({
          kind: 'error',
          title: 'Data source required',
          message: this.selectedSource() === 'excel'
            ? 'Choose a valid .xlsx workbook and select a worksheet to continue.'
            : 'Add at least one CSV file to continue.',
        });
        return;
      }
      this.currentStep.set(3);
    }
  }

  selectSource(source: WizardSource): void {
    if (this.processing() || this.selectedSource() === source) return;
    this.selectedSource.set(source);
    this.feedback.set(null);
  }

  onExcelFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith('.xlsx') || file.size <= 0) {
      this.excelFile.set(null);
      this.feedback.set({ kind: 'error', title: 'Workbook not added', message: 'Choose a non-empty Excel workbook with a .xlsx extension.' });
      return;
    }
    const item: WizardExcelFile = { id: `excel-${++this.fileSequence}`, file, preview: null, state: 'selected' };
    this.excelFile.set(item);
    this.loadExcelPreview();
  }

  onExcelWorksheetChange(event: Event): void {
    const worksheet = (event.target as HTMLSelectElement).value;
    if (worksheet) this.loadExcelPreview(worksheet);
  }

  removeExcelFile(): void {
    if (this.processing() || this.excelPreviewLoading()) return;
    this.excelFile.set(null);
    this.feedback.set(null);
  }

  previousStep(): void {
    if (this.processing()) {
      return;
    }
    this.feedback.set(null);
    if (this.currentStep() === 1) {
      void this.router.navigate(['/projects']);
      return;
    }
    this.currentStep.update((step) => (step - 1) as WizardStep);
  }

  cancel(): void {
    if (!this.processing()) {
      void this.router.navigate(['/projects']);
    }
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.processing()) {
      this.dragActive.set(true);
    }
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
    if (!this.processing()) {
      this.addFiles(Array.from(event.dataTransfer?.files ?? []));
    }
  }

  selectFile(index: number): void {
    if (index >= 0 && index < this.csvFiles().length) {
      this.selectedFileIndex.set(index);
    }
  }

  selectPreviousFile(): void {
    this.selectedFileIndex.update((index) => Math.max(0, index - 1));
  }

  selectNextFile(): void {
    this.selectedFileIndex.update((index) => Math.min(this.csvFiles().length - 1, index + 1));
  }

  removeFile(index: number): void {
    if (this.processing() || index < 0 || index >= this.csvFiles().length) {
      return;
    }

    const remaining = this.csvFiles().filter((_, itemIndex) => itemIndex !== index);
    this.selectedFileIndex.set(selectedIndexAfterRemoval(this.selectedFileIndex(), index, remaining.length));
    this.csvFiles.set(remaining);
    this.feedback.set(null);
  }

  formatSize(bytes: number): string {
    return formatFileSize(bytes);
  }

  previewValue(row: Record<string, unknown>, column: string): string {
    const value = row[column];
    return value === null || value === undefined ? 'Not available' : String(value);
  }

  createProject(): void {
    if (this.processing() || this.currentStep() !== 3 || !this.projectForm.valid || !this.sourceReady() || this.createdProject()) {
      return;
    }

    const userId = this.auth.userId();
    if (userId === null) {
      this.feedback.set({ kind: 'error', title: 'Session unavailable', message: 'Sign in again before creating the project.' });
      return;
    }

    const value = this.projectForm.getRawValue();
    const source = this.selectedSource();
    const files = [...this.csvFiles()];
    const excel = this.excelFile();
    this.feedback.set(null);
    this.submissionState.set('creating');

    this.api.createProject({
      userId,
      name: value.name.trim(),
      description: value.description.trim() || null,
    }).pipe(
      tap((project) => {
        this.createdProject.set(project);
        this.workflow.setProject(project);
      }),
      switchMap((project) => (source === 'excel' && excel
        ? this.uploadExcel(project, excel)
        : this.uploadFiles(project, files)).pipe(map((results) => ({ project, results })))),
    ).subscribe({
      next: ({ project }) => this.handleUploadCompletion(project),
      error: (error: unknown) => {
        this.submissionState.set('idle');
        this.feedback.set({
          kind: 'error',
          title: 'Failed to create the project',
          message: this.errorMessage(error, 'Failed to create the project. Please try again.'),
        });
      },
    });
  }

  retryFailedUploads(): void {
    const project = this.createdProject();
    const failed = this.failedFiles();
    const failedExcel = this.excelFile()?.state === 'failed' ? this.excelFile() : null;
    if (!project || this.failedCount() === 0 || this.processing()) {
      return;
    }

    this.feedback.set(null);
    (this.selectedSource() === 'excel' && failedExcel
      ? this.uploadExcel(project, failedExcel)
      : this.uploadFiles(project, failed)).subscribe({
      next: () => this.handleUploadCompletion(project),
    });
  }

  continueToProject(): void {
    const project = this.createdProject();
    if (!project || this.processing()) {
      return;
    }

    const uploaded = this.uploadedCount();
    const failedNames = this.selectedSource() === 'excel'
      ? this.excelFile()?.file.name ?? ''
      : this.failedFiles().map((item) => item.file.name).join(', ');
    this.allowNavigation = true;
    void this.router.navigate(['/projects', project.id, 'overview'], {
      state: {
        notice: `${project.name} was created and ${uploaded} data source${uploaded === 1 ? '' : 's'} imported. Failed imports: ${failedNames}.`,
      },
    });
  }

  dismissFeedback(): void {
    this.feedback.set(null);
  }

  canDeactivate(): boolean | Observable<boolean> {
    if (this.allowNavigation || !this.hasUnsavedChanges()) {
      return true;
    }
    if (this.processing()) {
      return false;
    }
    if (this.leaveDecision) {
      return this.leaveDecision.asObservable().pipe(take(1));
    }

    this.leaveDecision = new Subject<boolean>();
    this.leaveDialogOpen.set(true);
    return this.leaveDecision.asObservable().pipe(take(1));
  }

  resolveLeaveDialog(leave: boolean): void {
    const decision = this.leaveDecision;
    if (!decision) {
      return;
    }
    if (leave) {
      this.allowNavigation = true;
    }
    this.leaveDialogOpen.set(false);
    this.leaveDecision = null;
    decision.next(leave);
    decision.complete();
  }

  @HostListener('window:beforeunload', ['$event'])
  protectBrowserUnload(event: BeforeUnloadEvent): void {
    if (!this.allowNavigation && this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  @HostListener('document:keydown', ['$event'])
  manageLeaveDialogKeyboard(event: KeyboardEvent): void {
    if (!this.leaveDialogOpen()) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.resolveLeaveDialog(false);
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const stay = this.stayButton()?.nativeElement;
    const leave = this.leaveButton()?.nativeElement;
    if (!stay || !leave) {
      return;
    }
    if (event.shiftKey && document.activeElement === stay) {
      event.preventDefault();
      leave.focus();
    } else if (!event.shiftKey && document.activeElement === leave) {
      event.preventDefault();
      stay.focus();
    }
  }

  private addFiles(files: File[]): void {
    if (files.length === 0) {
      return;
    }

    const fingerprints = new Set(this.csvFiles().map((item) => fileFingerprint(item.file)));
    const additions: WizardCsvFile[] = [];
    const invalidTypes: string[] = [];
    const emptyFiles: string[] = [];
    const duplicates: string[] = [];

    for (const file of files) {
      if (!file.name.toLocaleLowerCase().endsWith('.csv')) {
        invalidTypes.push(file.name);
        continue;
      }
      if (!isCsvFile(file)) {
        emptyFiles.push(file.name);
        continue;
      }
      const fingerprint = fileFingerprint(file);
      if (fingerprints.has(fingerprint)) {
        duplicates.push(file.name);
        continue;
      }
      fingerprints.add(fingerprint);
      additions.push({ id: `csv-${++this.fileSequence}`, file, state: 'selected' });
    }

    if (additions.length > 0) {
      const previousCount = this.csvFiles().length;
      this.csvFiles.update((current) => [...current, ...additions]);
      if (this.selectedFileIndex() < 0) {
        this.selectedFileIndex.set(previousCount);
      }
    }

    const messages: string[] = [];
    if (invalidTypes.length > 0) {
      messages.push(`Only CSV files are supported: ${invalidTypes.join(', ')}.`);
    }
    if (emptyFiles.length > 0) {
      messages.push(`Empty CSV files cannot be uploaded: ${emptyFiles.join(', ')}.`);
    }
    if (duplicates.length > 0) {
      messages.push(`Already selected: ${duplicates.join(', ')}.`);
    }

    this.feedback.set(messages.length > 0
      ? {
          kind: additions.length > 0 ? 'warning' : 'error',
          title: additions.length > 0 ? 'Some files were not added' : 'Files not added',
          message: messages.join(' '),
        }
      : null);
  }

  private uploadFiles(project: ProjectResponse, files: WizardCsvFile[]): Observable<UploadResult[]> {
    this.submissionState.set('uploading');
    this.uploadCompleted.set(0);
    this.uploadTotal.set(files.length);

    return from(files).pipe(
      concatMap((item) => {
        this.updateFile(item.id, { state: 'uploading', error: undefined });
        const formData = new FormData();
        formData.append('file', item.file);
        formData.append('sourceType', 'csv');
        formData.append('sourceName', item.file.name);
        formData.append('tableName', this.tableNameFromFile(item.file));

        return this.api.uploadDataset(project.id, formData).pipe(
          map((dataset): UploadResult => ({ fileId: item.id, success: true, dataset })),
          catchError((error: unknown) => of<UploadResult>({
            fileId: item.id,
            success: false,
            error: this.errorMessage(error, 'Upload failed.'),
          })),
          tap((result) => {
            if (result.success && result.dataset) {
              this.updateFile(item.id, { state: 'uploaded', dataset: result.dataset, error: undefined });
              this.workflow.setDataset(result.dataset);
            } else {
              this.updateFile(item.id, { state: 'failed', error: result.error ?? 'Upload failed.' });
            }
            this.uploadCompleted.update((count) => count + 1);
          }),
        );
      }),
      toArray(),
    );
  }

  private uploadExcel(project: ProjectResponse, item: WizardExcelFile): Observable<UploadResult[]> {
    const worksheet = item.preview?.selectedWorksheet;
    if (!worksheet) {
      this.updateExcel({ state: 'failed', error: 'Select a worksheet before importing.' });
      return of([{ fileId: item.id, success: false, error: 'Select a worksheet before importing.' }]);
    }

    this.submissionState.set('uploading');
    this.uploadCompleted.set(0);
    this.uploadTotal.set(1);
    this.updateExcel({ state: 'uploading', error: undefined });
    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('sourceType', 'excel');
    formData.append('sourceName', item.file.name);
    formData.append('worksheetName', worksheet);
    formData.append('tableName', this.tableNameFromFile(item.file, worksheet));

    return this.api.uploadDataset(project.id, formData).pipe(
      map((dataset): UploadResult => ({ fileId: item.id, success: true, dataset })),
      catchError((error: unknown) => of<UploadResult>({ fileId: item.id, success: false, error: this.errorMessage(error, 'Excel import failed.') })),
      tap((result) => {
        if (result.success && result.dataset) {
          this.updateExcel({ state: 'uploaded', dataset: result.dataset, error: undefined });
          this.workflow.setDataset(result.dataset);
        } else {
          this.updateExcel({ state: 'failed', error: result.error ?? 'Excel import failed.' });
        }
        this.uploadCompleted.set(1);
      }),
      map((result) => [result]),
    );
  }

  private handleUploadCompletion(project: ProjectResponse): void {
    if (this.failedCount() > 0) {
      const uploaded = this.uploadedCount();
      const failed = this.failedCount();
      this.submissionState.set('partial');
      this.feedback.set({
        kind: 'warning',
        title: 'Project created with upload issues',
        message: `The project was created, but some data sources could not be imported. ${uploaded} succeeded and ${failed} failed.`,
      });
      return;
    }

    this.submissionState.set('success');
    this.feedback.set({ kind: 'success', title: 'Project created successfully', message: 'Project created successfully.' });
    this.allowNavigation = true;
    void this.router.navigate(['/projects', project.id, 'overview'], {
      state: { notice: 'Project created successfully.' },
    });
  }

  private updateFile(id: string, update: Partial<WizardCsvFile>): void {
    this.csvFiles.update((files) => files.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  private updateExcel(update: Partial<WizardExcelFile>): void {
    this.excelFile.update((item) => item ? { ...item, ...update } : null);
  }

  private loadExcelPreview(worksheetName?: string): void {
    const item = this.excelFile();
    if (!item) return;
    this.excelPreviewLoading.set(true);
    this.feedback.set(null);
    const formData = new FormData();
    formData.append('file', item.file);
    if (worksheetName) formData.append('worksheetName', worksheetName);
    this.api.previewExcel(formData).subscribe({
      next: (preview) => {
        this.excelPreviewLoading.set(false);
        this.updateExcel({ preview, error: undefined });
      },
      error: (error: unknown) => {
        this.excelPreviewLoading.set(false);
        const message = this.errorMessage(error, 'Unable to read this Excel workbook.');
        this.updateExcel({ preview: null, error: message });
        this.feedback.set({ kind: 'error', title: 'Workbook preview failed', message });
      },
    });
  }

  private tableNameFromFile(file: File, worksheet?: string): string {
    const base = file.name.replace(/\.(csv|xlsx)$/i, '');
    return `${base}${worksheet ? `_${worksheet}` : ''}`
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'dataset';
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    }
    return fallback;
  }
}
