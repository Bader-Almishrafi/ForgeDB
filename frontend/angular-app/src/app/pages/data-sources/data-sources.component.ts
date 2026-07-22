import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { catchError, finalize, map, of, Subject, switchMap, tap } from 'rxjs';
import {
  DatasetPreview,
  DatasetResponse,
  ProjectResponse,
  ProjectWorkflowDataset,
} from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { routeParameter } from '../../services/route-context';
import { EditProjectDialogComponent } from './dialogs/edit-project-dialog.component';
import { DeleteDatasetDialogComponent } from './dialogs/delete-dataset-dialog.component';
import { ReplaceDatasetDialogComponent } from './dialogs/replace-dataset-dialog.component';
import { ImportDatasetDialogComponent } from './dialogs/import-dataset-dialog.component';

type ImportSource = 'csv' | 'excel' | 'api';

@Component({
  selector: 'app-data-sources',
  standalone: true,
  imports: [DecimalPipe, FormsModule, EditProjectDialogComponent, DeleteDatasetDialogComponent, ReplaceDatasetDialogComponent, ImportDatasetDialogComponent],
  templateUrl: './data-sources.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataSourcesComponent implements OnInit {
  private readonly api = inject(ForgeApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
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
  readonly importSource = signal<ImportSource | null>(null);

  readonly replaceOpen = signal(false);
  readonly confirmingDelete = signal(false);
  readonly editOpen = signal(false);
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
    this.titleService.setTitle('Data Sources - ForgeDB');
    this.metaService.updateTag({ name: 'description', content: 'Manage datasets for your ForgeDB project.' });
    
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

  openImport(source: ImportSource | null = null): void {
    this.importSource.set(source);
    this.importOpen.set(true);
  }

  onDatasetImported(dataset: DatasetResponse): void {
    this.successMessage.set(`${this.displayName(dataset)} imported successfully.`);
    this.importOpen.set(false);
    this.importSource.set(null);
    this.loadDatasets(dataset.id);
    this.refreshWorkflow();
  }

  onDatasetReplaced(updated: DatasetResponse): void {
    this.successMessage.set(`${this.displayName(updated)} was replaced. Re-analysis is required; previous versions remain in history.`);
    this.replaceOpen.set(false);
    this.loadDatasets(updated.id);
    this.refreshWorkflow();
  }

  onDatasetDeleted(): void {
    const dataset = this.selectedDataset();
    if (dataset) this.successMessage.set(`${this.displayName(dataset)} was deleted.`);
    this.confirmingDelete.set(false);
    this.selectedDatasetId.set(null);
    this.loadDatasets();
    this.refreshWorkflow();
  }

  onProjectSaved(updated: ProjectResponse): void {
    this.project.set(updated);
    this.editOpen.set(false);
    this.successMessage.set('Project details updated.');
    this.refreshWorkflow();
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
