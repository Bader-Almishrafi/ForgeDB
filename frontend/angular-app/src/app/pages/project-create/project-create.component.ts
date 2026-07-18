import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, Subject, catchError, concatMap, from, map, of, switchMap, take, tap, toArray } from 'rxjs';
import { ApiConnectionTest, ApiJsonImportRequest, ApiJsonPreview, DatasetResponse, ExcelWorkbookPreview, ProjectResponse } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { UnsavedChangesAware } from '../../services/unsaved-changes.guard';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { fileFingerprint, formatFileSize, isCsvFile, selectedIndexAfterRemoval } from './project-create.utils';

// -----------------------------------------------------------------------------
// Wizard types and data carried between steps
// -----------------------------------------------------------------------------

// Submission states distinguish each server phase: creating sends the Project request, uploading
// imports data, partial means the Project exists but at least one import failed, and success means
// every selected source imported. The UI uses these differences to offer retry or navigation.
type WizardStep = 1 | 2 | 3;
type SubmissionState = 'idle' | 'creating' | 'uploading' | 'partial' | 'success';
type FileUploadState = 'selected' | 'uploading' | 'uploaded' | 'failed';
type FeedbackKind = 'success' | 'warning' | 'error';
type WizardSource = 'csv' | 'excel' | 'api';

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

// Rejects names made only of spaces; Validators.required alone considers that text present.
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
// Combines project details, source selection, project creation, CSV/Excel/API import,
// partial-upload recovery, and navigation protection into one three-step workflow.
export class ProjectCreateComponent implements UnsavedChangesAware {
  // ---------------------------------------------------------------------------
  // Injected services
  // ---------------------------------------------------------------------------

  // FormBuilder owns the reactive form; the API service sends HTTP requests, while the
  // authentication and workflow services supply the current user and cross-page selection.
  private readonly formBuilder = inject(FormBuilder);
  private readonly api = inject(ForgeApiService);
  private readonly auth = inject(AuthService);
  private readonly workflow = inject(WorkflowStateService);
  private readonly router = inject(Router);

  // ---------------------------------------------------------------------------
  // Local state used outside Angular Signals
  // ---------------------------------------------------------------------------

  private fileSequence = 0;
  // allowNavigation bypasses the guard only after an intentional leave or successful completion.
  private allowNavigation = false;
  // One pending Subject lets the route guard wait for the current dialog decision without
  // opening duplicate dialogs if Angular asks canDeactivate more than once.
  private leaveDecision: Subject<boolean> | null = null;

  // ---------------------------------------------------------------------------
  // Angular Signals
  // ---------------------------------------------------------------------------

  // signal() creates reactive state read by the OnPush template. Updating a signal schedules
  // the affected view and any computed signals that depend on it.
  readonly stayButton = viewChild<ElementRef<HTMLButtonElement>>('stayButton');
  readonly leaveButton = viewChild<ElementRef<HTMLButtonElement>>('leaveButton');
  readonly currentStep = signal<WizardStep>(1);
  readonly selectedSource = signal<WizardSource>('csv');
  readonly csvFiles = signal<WizardCsvFile[]>([]);
  readonly excelFile = signal<WizardExcelFile | null>(null);
  readonly excelPreviewLoading = signal(false);
  readonly apiUrl = signal('');
  readonly apiArrayPath = signal('');
  readonly apiConnection = signal<ApiConnectionTest | null>(null);
  readonly apiPreview = signal<ApiJsonPreview | null>(null);
  readonly apiTesting = signal(false);
  readonly apiPreviewLoading = signal(false);
  readonly apiImportState = signal<FileUploadState>('selected');
  readonly apiDataset = signal<DatasetResponse | null>(null);
  readonly apiError = signal('');
  readonly selectedFileIndex = signal(-1);
  readonly dragActive = signal(false);
  readonly submissionState = signal<SubmissionState>('idle');
  readonly createdProject = signal<ProjectResponse | null>(null);
  readonly uploadCompleted = signal(0);
  readonly uploadTotal = signal(0);
  readonly feedback = signal<FeedbackMessage | null>(null);
  readonly leaveDialogOpen = signal(false);

  // ---------------------------------------------------------------------------
  // Reactive Form
  // ---------------------------------------------------------------------------

  // FormBuilder creates a typed, non-nullable form. Validators enforce the same user-facing
  // limits before submission, while the backend repeats validation as the security boundary.
  readonly projectForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100), trimmedRequired]],
    description: ['', [Validators.maxLength(500)]],
  });
  // toSignal bridges the form's RxJS valueChanges stream into Signal dependency tracking.
  // getRawValue() supplies a complete initial value even before the user edits the form.
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

  // ---------------------------------------------------------------------------
  // Computed Signals
  // ---------------------------------------------------------------------------

  // computed() recalculates when any signal read inside its callback changes, then caches the
  // result until the next dependency change. These values keep template rules declarative.
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
  readonly sourceReady = computed(() => {
    if (this.selectedSource() === 'csv') return this.csvFiles().length > 0;
    if (this.selectedSource() === 'excel') return !!this.excelFile()?.preview?.selectedWorksheet;
    return this.apiUrl().trim().length > 0 && !!this.apiPreview();
  });
  readonly uploadedCount = computed(() => {
    if (this.selectedSource() === 'csv') return this.uploadedFiles().length;
    if (this.selectedSource() === 'excel') return this.excelFile()?.state === 'uploaded' ? 1 : 0;
    return this.apiImportState() === 'uploaded' ? 1 : 0;
  });
  readonly failedCount = computed(() => {
    if (this.selectedSource() === 'csv') return this.failedFiles().length;
    if (this.selectedSource() === 'excel') return this.excelFile()?.state === 'failed' ? 1 : 0;
    return this.apiImportState() === 'failed' ? 1 : 0;
  });
  readonly hasUnsavedChanges = computed(() => {
    const value = this.formValue();
    return value.name.length > 0
      || value.description.length > 0
      || this.currentStep() !== 1
      || this.csvFiles().length > 0
      || !!this.excelFile()
      || this.apiUrl().length > 0
      || this.apiArrayPath().length > 0;
  });

  // effect() runs a side effect whenever leaveDialogOpen changes; focus is deferred until
  // Angular has rendered the dialog button into the DOM.
  constructor() {
    effect(() => {
      if (this.leaveDialogOpen()) {
        queueMicrotask(() => this.stayButton()?.nativeElement.focus());
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Wizard navigation and source selection
  // ---------------------------------------------------------------------------

  // Advances only when the current step is valid. markAllAsTouched() reveals all form
  // validation messages when the user attempts to continue with incomplete details.
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
            : this.selectedSource() === 'api'
              ? 'Enter an HTTP or HTTPS API URL and preview its JSON array to continue.'
              : 'Add at least one CSV file to continue.',
        });
        return;
      }
      this.currentStep.set(3);
    }
  }

  // Switches the import strategy while preventing source changes during an active request.
  selectSource(source: WizardSource): void {
    if (this.processing() || this.apiTesting() || this.apiPreviewLoading() || this.selectedSource() === source) return;
    this.selectedSource.set(source);
    this.feedback.set(null);
  }

  // ---------------------------------------------------------------------------
  // API data-source handling
  // ---------------------------------------------------------------------------

  // Any URL edit invalidates earlier connection and preview results because they describe
  // a different remote request.
  updateApiUrl(value: string): void {
    this.apiUrl.set(value);
    this.resetApiResults();
  }

  // Changing the JSON array path also invalidates results derived from the previous path.
  updateApiArrayPath(value: string): void {
    this.apiArrayPath.set(value);
    this.resetApiResults();
  }

  // Calls the lightweight API connectivity endpoint and stores either diagnostic metadata
  // or a normalized error for the source-selection UI.
  testApiConnection(): void {
    if (!this.apiUrl().trim() || this.apiTesting() || this.processing()) return;
    this.apiTesting.set(true);
    this.apiConnection.set(null);
    this.apiError.set('');
    this.feedback.set(null);
    this.api.testApiConnection(this.apiRequest()).subscribe({
      next: (connection) => {
        this.apiTesting.set(false);
        this.apiConnection.set(connection);
      },
      error: (error: unknown) => {
        this.apiTesting.set(false);
        const message = this.errorMessage(error, 'Unable to connect to this API.');
        this.apiError.set(message);
        this.feedback.set({ kind: 'error', title: 'API connection failed', message });
      },
    });
  }

  // Fetches a sample JSON array so the user can verify shape and columns before importing it.
  previewApiData(): void {
    if (!this.apiUrl().trim() || this.apiPreviewLoading() || this.processing()) return;
    this.apiPreviewLoading.set(true);
    this.apiPreview.set(null);
    this.apiError.set('');
    this.feedback.set(null);
    this.api.previewApi(this.apiRequest()).subscribe({
      next: (preview) => {
        this.apiPreviewLoading.set(false);
        this.apiPreview.set(preview);
      },
      error: (error: unknown) => {
        this.apiPreviewLoading.set(false);
        const message = this.errorMessage(error, 'Unable to preview data from this API.');
        this.apiError.set(message);
        this.feedback.set({ kind: 'error', title: 'API preview failed', message });
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Excel handling
  // ---------------------------------------------------------------------------

  // Accepts one non-empty .xlsx file, clears the native input for reselection, and immediately
  // asks the backend to inspect workbook sheets and preview data.
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

  // Reloads the workbook preview for the newly selected worksheet.
  onExcelWorksheetChange(event: Event): void {
    const worksheet = (event.target as HTMLSelectElement).value;
    if (worksheet) this.loadExcelPreview(worksheet);
  }

  // Removes the pending workbook only when no preview or import request is running.
  removeExcelFile(): void {
    if (this.processing() || this.excelPreviewLoading()) return;
    this.excelFile.set(null);
    this.feedback.set(null);
  }

  // Returns to the prior wizard step, or asks the router to leave when already on step one.
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

  // Starts navigation back to the projects list; the route guard still decides whether
  // unsaved work requires confirmation.
  cancel(): void {
    if (!this.processing()) {
      void this.router.navigate(['/projects']);
    }
  }

  // ---------------------------------------------------------------------------
  // CSV handling
  // ---------------------------------------------------------------------------

  // Converts the browser FileList into an array for shared validation with drag-and-drop.
  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  // Keeps the browser from opening the dragged file and exposes drop-zone feedback.
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.processing()) {
      this.dragActive.set(true);
    }
  }

  // Clears drag feedback when the pointer leaves the drop target.
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
  }

  // Routes dropped files through the same duplicate, type, and empty-file checks as file input.
  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
    if (!this.processing()) {
      this.addFiles(Array.from(event.dataTransfer?.files ?? []));
    }
  }

  // Selects which queued CSV supplies the detail preview.
  selectFile(index: number): void {
    if (index >= 0 && index < this.csvFiles().length) {
      this.selectedFileIndex.set(index);
    }
  }

  // Moves the preview selection backward without crossing the first file.
  selectPreviousFile(): void {
    this.selectedFileIndex.update((index) => Math.max(0, index - 1));
  }

  // Moves the preview selection forward without crossing the final file.
  selectNextFile(): void {
    this.selectedFileIndex.update((index) => Math.min(this.csvFiles().length - 1, index + 1));
  }

  // Removes a queued CSV and chooses a valid neighboring preview index for the remaining list.
  removeFile(index: number): void {
    if (this.processing() || index < 0 || index >= this.csvFiles().length) {
      return;
    }

    const remaining = this.csvFiles().filter((_, itemIndex) => itemIndex !== index);
    this.selectedFileIndex.set(selectedIndexAfterRemoval(this.selectedFileIndex(), index, remaining.length));
    this.csvFiles.set(remaining);
    this.feedback.set(null);
  }

  // Delegates byte formatting to the shared utility so all file sizes use one convention.
  formatSize(bytes: number): string {
    return formatFileSize(bytes);
  }

  // Converts unknown preview cell values into safe display text without changing imported data.
  previewValue(row: Record<string, unknown>, column: string): string {
    const value = row[column];
    return value === null || value === undefined ? 'Not available' : String(value);
  }

  // ---------------------------------------------------------------------------
  // Project creation and selected dataset import
  // ---------------------------------------------------------------------------

  // Creates the project first, stores its server-generated ID, then imports the selected source.
  // Flow: create Project -> save ProjectResponse -> obtain project.id -> run import -> wait for
  // completion -> navigate on success or expose retry controls after partial failure.
  createProject(): void {
    if (this.processing() || this.currentStep() !== 3 || !this.projectForm.valid || !this.sourceReady() || this.createdProject()) {
      return;
    }

    const userId = this.auth.userId();
    if (userId === null) {
      this.feedback.set({ kind: 'error', title: 'Session unavailable', message: 'Sign in again before creating the project.' });
      return;
    }

    // getRawValue() returns the complete typed form value, including controls regardless of state.
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
      // tap performs state side effects without changing the ProjectResponse flowing downstream.
      tap((project) => {
        this.createdProject.set(project);
        this.workflow.setProject(project);
      }),
      // switchMap waits for project creation, then replaces that Observable with the selected
      // import Observable. This is necessary because every import endpoint requires project.id.
      switchMap((project) => (source === 'api'
        ? this.importApi(project)
        : source === 'excel' && excel
          ? this.uploadExcel(project, excel)
          // map keeps both the created project and collected import results available downstream.
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

  // ---------------------------------------------------------------------------
  // Retry behavior and completion navigation
  // ---------------------------------------------------------------------------

  // Retries only failed imports against the already-created project. Keeping createdProject
  // prevents a retry from creating a duplicate project record.
  retryFailedUploads(): void {
    const project = this.createdProject();
    const failed = this.failedFiles();
    const failedExcel = this.excelFile()?.state === 'failed' ? this.excelFile() : null;
    if (!project || this.failedCount() === 0 || this.processing()) {
      return;
    }

    this.feedback.set(null);
    (this.selectedSource() === 'api'
      ? this.importApi(project)
      : this.selectedSource() === 'excel' && failedExcel
        ? this.uploadExcel(project, failedExcel)
        : this.uploadFiles(project, failed)).subscribe({
      next: () => this.handleUploadCompletion(project),
    });
  }

  // Accepts a partial result, allows the guard to pass, and carries failed source names to the
  // overview page so the user understands which imports still need attention.
  continueToProject(): void {
    const project = this.createdProject();
    if (!project || this.processing()) {
      return;
    }

    const uploaded = this.uploadedCount();
    const failedNames = this.selectedSource() === 'api'
      ? this.apiUrl()
      : this.selectedSource() === 'excel'
        ? this.excelFile()?.file.name ?? ''
        : this.failedFiles().map((item) => item.file.name).join(', ');
    this.allowNavigation = true;
    void this.router.navigate(['/projects', project.id, 'overview'], {
      state: {
        notice: `${project.name} was created and ${uploaded} data source${uploaded === 1 ? '' : 's'} imported. Failed imports: ${failedNames}.`,
      },
    });
  }

  // Clears transient success, warning, or error feedback without changing wizard progress.
  dismissFeedback(): void {
    this.feedback.set(null);
  }

  // ---------------------------------------------------------------------------
  // Unsaved-changes protection
  // ---------------------------------------------------------------------------

  // Implements UnsavedChangesAware for the route guard. It allows completed/clean navigation,
  // blocks navigation during active requests, or returns a one-value Observable that resolves
  // after the custom leave dialog records the user's decision.
  canDeactivate(): boolean | Observable<boolean> {
    if (this.allowNavigation || !this.hasUnsavedChanges()) {
      return true;
    }
    if (this.processing()) {
      return false;
    }
    if (this.leaveDecision) {
      // take(1) completes the guard subscription after one answer and avoids retaining observers.
      return this.leaveDecision.asObservable().pipe(take(1));
    }

    this.leaveDecision = new Subject<boolean>();
    this.leaveDialogOpen.set(true);
    return this.leaveDecision.asObservable().pipe(take(1));
  }

  // Resolves the pending route guard and sets allowNavigation only for an intentional leave.
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
  // Covers tab close, refresh, and address-bar navigation, which Angular's route guard cannot see.
  protectBrowserUnload(event: BeforeUnloadEvent): void {
    if (!this.allowNavigation && this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  @HostListener('document:keydown', ['$event'])
  // Gives the custom confirmation dialog Escape behavior and traps Tab focus between its actions.
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

  // ---------------------------------------------------------------------------
  // CSV selection validation
  // ---------------------------------------------------------------------------

  // Validates a batch, filters unsupported/empty/duplicate files, appends accepted CSVs, and
  // reports rejected names without discarding valid files from the same selection.
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

  // ---------------------------------------------------------------------------
  // Dataset upload and import pipelines
  // ---------------------------------------------------------------------------

  // Converts the file array with from(), uploads one CSV at a time with concatMap(), updates each
  // file through tap(), and collects every UploadResult into one array with toArray(). Sequential
  // uploads make progress and per-file state deterministic.
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
          // map converts the successful DatasetResponse into the common result shape.
          map((dataset): UploadResult => ({ fileId: item.id, success: true, dataset })),
          // catchError is inside concatMap, so one failed CSV becomes a value via of() instead of
          // terminating the outer stream and preventing later files from uploading.
          catchError((error: unknown) => of<UploadResult>({
            fileId: item.id,
            success: false,
            error: this.errorMessage(error, 'Upload failed.'),
          })),
          // tap synchronizes progress and workflow state while leaving the result unchanged.
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
      // toArray waits for all sequential uploads to complete before emitting once.
      toArray(),
    );
  }

  // Imports the selected Excel worksheet as one dataset and adapts its single result to the same
  // UploadResult[] contract used by CSV and API sources.
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

  // Imports the previewed API JSON array into the created project and records its dataset or
  // recoverable failure using the same submission-state model as file uploads.
  private importApi(project: ProjectResponse): Observable<UploadResult[]> {
    this.submissionState.set('uploading');
    this.uploadCompleted.set(0);
    this.uploadTotal.set(1);
    this.apiImportState.set('uploading');
    this.apiError.set('');
    return this.api.importApi(project.id, this.apiRequest()).pipe(
      map((dataset): UploadResult => ({ fileId: 'api', success: true, dataset })),
      catchError((error: unknown) => of<UploadResult>({ fileId: 'api', success: false, error: this.errorMessage(error, 'API import failed.') })),
      tap((result) => {
        if (result.success && result.dataset) {
          this.apiImportState.set('uploaded');
          this.apiDataset.set(result.dataset);
          this.workflow.setDataset(result.dataset);
        } else {
          this.apiImportState.set('failed');
          this.apiError.set(result.error ?? 'API import failed.');
        }
        this.uploadCompleted.set(1);
      }),
      map((result) => [result]),
    );
  }

  // ---------------------------------------------------------------------------
  // Success and partial-success handling
  // ---------------------------------------------------------------------------

  // Distinguishes partial from complete success after an import pipeline finishes. A partial
  // state keeps the created project in place for retry; success permits navigation immediately.
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

  // ---------------------------------------------------------------------------
  // Signal update, request, and error-handling utilities
  // ---------------------------------------------------------------------------

  // Immutably replaces one CSV entry so Signal consumers receive a new array reference.
  private updateFile(id: string, update: Partial<WizardCsvFile>): void {
    this.csvFiles.update((files) => files.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  // Immutably merges preview, progress, result, or error fields into the selected workbook.
  private updateExcel(update: Partial<WizardExcelFile>): void {
    this.excelFile.update((item) => item ? { ...item, ...update } : null);
  }

  // Sends the workbook to the preview endpoint; an optional worksheet reloads the sampled rows
  // without committing any dataset to the project.
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

  // Normalizes the API URL and optional array path into the request contract shared by test,
  // preview, and final import endpoints.
  private apiRequest(): ApiJsonImportRequest {
    const arrayPath = this.apiArrayPath().trim();
    return { apiUrl: this.apiUrl().trim(), arrayPath: arrayPath || null };
  }

  // Invalidates all API-derived state whenever its URL or array path changes.
  private resetApiResults(): void {
    this.apiConnection.set(null);
    this.apiPreview.set(null);
    this.apiDataset.set(null);
    this.apiImportState.set('selected');
    this.apiError.set('');
    this.feedback.set(null);
  }

  // Produces a database-friendly default table name from a file and optional worksheet label.
  private tableNameFromFile(file: File, worksheet?: string): string {
    const base = file.name.replace(/\.(csv|xlsx)$/i, '');
    return `${base}${worksheet ? `_${worksheet}` : ''}`
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'dataset';
  }

  // Extracts the backend's JSON message when available and otherwise returns stable UI copy.
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
