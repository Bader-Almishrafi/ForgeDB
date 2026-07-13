import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, map, of, Subject, switchMap, tap } from 'rxjs';
import { DatasetPreview, DatasetResponse, ProjectOverview, ProjectResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { AppNotification, RecentActivity } from '../../shared/home.models';

type StageStatus = 'Completed' | 'In Progress' | 'Not Started' | 'Blocked' | 'Status unavailable';

interface WorkflowStage {
  name: string;
  description: string;
  status: StageStatus;
  icon: string;
  action: string;
  enabled: boolean;
  unavailableReason?: string;
  route?: string;
}

@Component({
  selector: 'app-project-overview',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './project-overview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectOverviewComponent implements OnInit {
  private readonly api = inject(ForgeApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly workflow = inject(WorkflowStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly previewRequests = new Subject<number>();

  readonly project = signal<ProjectResponse | null>(null);
  readonly overview = signal<ProjectOverview | null>(null);
  readonly datasets = signal<DatasetResponse[]>([]);
  readonly selectedDatasetId = signal<number | null>(null);
  readonly projectLoading = signal(false);
  readonly datasetsLoading = signal(false);
  readonly previewLoading = signal(false);
  readonly projectError = signal('');
  readonly datasetsError = signal('');
  readonly previewError = signal('');
  readonly preview = signal<DatasetPreview | null>(null);
  readonly sourcePanelOpen = signal(false);
  readonly navigationNotice = signal('');
  readonly datasetSearch = signal('');
  readonly projectAlerts = signal<AppNotification[]>([]);
  readonly recentActivity = signal<RecentActivity[]>([]);
  readonly editingProject = signal(false);
  readonly savingProjectEdit = signal(false);
  readonly projectEditError = signal('');
  editProjectName = '';
  editProjectDescription = '';
  projectId = 0;

  readonly selectedDataset = computed(() => this.datasets().find((dataset) => dataset.id === this.selectedDatasetId()) ?? null);
  readonly selectedIndex = computed(() => this.datasets().findIndex((dataset) => dataset.id === this.selectedDatasetId()));
  readonly filteredDatasets = computed(() => {
    const query = this.datasetSearch().trim().toLocaleLowerCase();
    return query
      ? this.datasets().filter((dataset) => `${dataset.tableName} ${dataset.sourceName ?? ''}`.toLocaleLowerCase().includes(query))
      : this.datasets();
  });
  readonly previewColumns = computed(() => this.preview()?.columns ?? []);
  readonly previewRows = computed(() => (this.preview()?.rows ?? []).slice(0, 8));
  readonly stages = computed<WorkflowStage[]>(() => this.createStages());
  readonly completedStages = computed(() => this.stages().filter((stage) => stage.status === 'Completed').length);
  readonly recommendation = computed(() => this.createRecommendation());

  constructor() {
    this.previewRequests.pipe(
      tap(() => {
        this.previewLoading.set(true);
        this.previewError.set('');
        this.preview.set(null);
      }),
      switchMap((datasetId) => this.api.getDatasetPreview(datasetId).pipe(
        map((preview) => ({ preview, error: '' })),
        catchError((error: unknown) => of({ preview: null, error: this.errorMessage(error, 'Data preview is not available yet.') })),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ preview, error }) => {
      this.preview.set(preview);
      this.previewError.set(error);
      this.previewLoading.set(false);
    });
  }

  ngOnInit(): void {
    const state = history.state as { notice?: unknown };
    if (typeof state.notice === 'string') {
      this.navigationNotice.set(state.notice);
    }
    this.projectId = Number(this.route.snapshot.paramMap.get('projectId'));
    if (!Number.isFinite(this.projectId) || this.projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }
    this.workflow.setProjectId(this.projectId);
    this.loadWorkspace();
  }

  loadWorkspace(): void {
    this.loadProject();
    this.loadDatasets();
  }

  loadProject(): void {
    this.projectLoading.set(true);
    this.projectError.set('');
    forkJoin({
      project: this.api.getProject(this.projectId),
      overview: this.api.getProjectOverview(this.projectId),
    }).pipe(finalize(() => this.projectLoading.set(false))).subscribe({
      next: ({ project, overview }) => {
        this.project.set(project);
        this.overview.set(overview);
        this.workflow.setProject(project);
      },
      error: (error: unknown) => {
        this.projectError.set(error instanceof HttpErrorResponse && error.status === 404
          ? 'Project not found.'
          : this.errorMessage(error, 'Unable to load the project overview.'));
      },
    });
  }

  loadDatasets(): void {
    this.datasetsLoading.set(true);
    this.datasetsError.set('');
    this.api.getProjectDatasets(this.projectId)
      .pipe(finalize(() => this.datasetsLoading.set(false)))
      .subscribe({
        next: (datasets) => {
          this.datasets.set(datasets);
          this.initializeSelection(datasets);
        },
        error: (error: unknown) => this.datasetsError.set(this.errorMessage(error, 'Unable to load project datasets.')),
      });
  }

  selectDataset(dataset: DatasetResponse, updateUrl = true): void {
    if (!this.datasets().some((item) => item.id === dataset.id)) {
      return;
    }
    this.selectedDatasetId.set(dataset.id);
    this.workflow.setDataset(dataset);
    this.previewRequests.next(dataset.id);
    if (updateUrl) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { dataset: dataset.id },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  previousDataset(): void {
    const index = this.selectedIndex();
    if (index > 0) {
      this.selectDataset(this.datasets()[index - 1]);
    }
  }

  nextDataset(): void {
    const index = this.selectedIndex();
    if (index >= 0 && index < this.datasets().length - 1) {
      this.selectDataset(this.datasets()[index + 1]);
    }
  }

  updateSearch(value: string): void {
    this.datasetSearch.set(value);
  }

  openStage(stage: WorkflowStage): void {
    if (!stage.enabled || !stage.route) {
      return;
    }
    const dataset = this.selectedDataset();
    if (dataset) {
      this.workflow.setDataset(dataset);
    }
    void this.router.navigateByUrl(stage.route);
  }

  analyzeSelected(): void {
    const dataset = this.selectedDataset();
    if (dataset) {
      this.workflow.setDataset(dataset);
      void this.router.navigate(['/datasets', dataset.id, 'analyze'], { queryParams: { returnProject: this.projectId } });
    }
  }

  retryPreview(): void {
    const dataset = this.selectedDataset();
    if (dataset) {
      this.previewRequests.next(dataset.id);
    }
  }

  previewValue(row: Record<string, unknown>, column: string): string {
    const value = row[column];
    return value === null || value === undefined ? '—' : String(value);
  }

  statusClass(status: StageStatus): string {
    if (status === 'Completed') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300';
    if (status === 'In Progress') return 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300';
    if (status === 'Blocked') return 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300';
    return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  }

  dismissNavigationNotice(): void {
    this.navigationNotice.set('');
  }

  startEditProject(): void {
    const current = this.project();
    if (!current) return;
    this.editProjectName = current.name;
    this.editProjectDescription = current.description ?? '';
    this.projectEditError.set('');
    this.editingProject.set(true);
  }

  cancelEditProject(): void {
    this.editingProject.set(false);
    this.projectEditError.set('');
  }

  saveProjectEdit(): void {
    const name = this.editProjectName.trim();
    if (!name || this.savingProjectEdit()) {
      return;
    }
    this.savingProjectEdit.set(true);
    this.projectEditError.set('');
    this.api.updateProject(this.projectId, { name, description: this.editProjectDescription.trim() || null })
      .pipe(finalize(() => this.savingProjectEdit.set(false)))
      .subscribe({
        next: (updated) => {
          this.project.set(updated);
          this.workflow.setProject(updated);
          this.editingProject.set(false);
        },
        error: (error: unknown) => this.projectEditError.set(this.errorMessage(error, 'Unable to update the project.')),
      });
  }

  private initializeSelection(datasets: DatasetResponse[]): void {
    if (datasets.length === 0) {
      this.selectedDatasetId.set(null);
      this.preview.set(null);
      this.workflow.clearDataset();
      return;
    }
    const queryId = Number(this.route.snapshot.queryParamMap.get('dataset'));
    const storedId = this.workflow.datasetId();
    const selected = datasets.find((dataset) => dataset.id === queryId)
      ?? datasets.find((dataset) => dataset.id === storedId)
      ?? datasets[0];
    this.selectDataset(selected, selected.id !== queryId);
  }

  private createStages(): WorkflowStage[] {
    const datasets = this.datasets();
    const overview = this.overview();
    const hasData = datasets.length > 0;
    const analyzed = datasets.filter((dataset) => dataset.status.toLocaleLowerCase() === 'analyzed').length;
    const analysisStatus: StageStatus = !hasData ? 'Blocked' : analyzed === datasets.length ? 'Completed' : analyzed > 0 ? 'In Progress' : 'Not Started';
    const hasCleaningWork = (overview?.cleaningBatchesCount ?? 0) > 0;
    const qualityConfirmed = overview?.qualityConfirmed ?? false;
    const schemaReady = overview?.schemaReady ?? false;
    const cleaningStatus: StageStatus = !hasData
      ? 'Blocked'
      : qualityConfirmed && schemaReady
        ? 'Completed'
        : hasCleaningWork
          ? 'In Progress'
          : analyzed > 0
            ? 'Not Started'
            : 'Blocked';
    const schemaStatus: StageStatus = overview?.generatedSchemasCount ? 'Completed' : schemaReady ? 'Not Started' : 'Blocked';
    return [
      { name: 'Data Sources', description: 'Upload and manage project datasets.', status: hasData ? 'Completed' : 'Not Started', action: hasData ? 'Manage Sources' : 'Add Data', enabled: true, route: `/projects/${this.projectId}/datasets`, icon: 'M4 6h16v5H4V6Zm0 7h16v5H4v-5Z' },
      { name: 'Analysis', description: 'Profile structure and data quality across project sources.', status: analysisStatus, action: 'Open Project Analysis', enabled: hasData, route: `/projects/${this.projectId}/analysis`, icon: 'M4 19V9m5 10V5m5 14v-7m5 7V3' },
      { name: 'Data Cleaning', description: 'Preview and resolve detected quality issues using versioned changes.', status: cleaningStatus, action: 'Open Data Cleaning', enabled: hasData && (analyzed > 0 || hasCleaningWork), route: `/projects/${this.projectId}/data-cleaning`, unavailableReason: 'Analyze at least one dataset first.', icon: 'm4 20 5-5m0 0 8-8 2 2-8 8m-2-2-4-4' },
      { name: 'Schema', description: 'Design tables, columns, and constraints.', status: schemaStatus, action: 'Open Schema', enabled: schemaReady, route: `/projects/${this.projectId}/schema-designer`, unavailableReason: 'Clean, re-analyze, and confirm the active dataset versions first.', icon: 'M4 5h6v6H4V5Zm10 0h6v6h-6V5ZM4 15h6v4H4v-4Zm10 0h6v4h-6v-4Z' },
      { name: 'Relationships', description: 'Review connections between tables.', status: overview?.relationshipSuggestionsCount ? 'In Progress' : schemaStatus === 'Completed' ? 'Not Started' : 'Blocked', action: 'Review Relationships', enabled: true, route: `/projects/${this.projectId}/relationships`, icon: 'M5 5h5v5H5V5Zm9 9h5v5h-5v-5Zm-4-6h3a4 4 0 0 1 4 4v2' },
      { name: 'Deployment', description: 'Prepare and deploy the database.', status: 'Status unavailable', action: 'Unavailable', enabled: false, unavailableReason: 'No deployment route or backend integration exists.', icon: 'M12 3v12m0 0 4-4m-4 4-4-4M5 17v4h14v-4' },
    ];
  }

  private createRecommendation(): { title: string; description: string; action: string; route: string } {
    const dataset = this.selectedDataset();
    const overview = this.overview();
    if (!dataset) return { title: 'Add a CSV file to start building your database.', description: 'Your first dataset unlocks analysis and schema design.', action: 'Add CSV Files', route: `/projects/${this.projectId}/datasets` };
    if (overview?.schemaReady && !overview.generatedSchemasCount) return { title: 'Your cleaned data is confirmed and ready for schema design.', description: 'Generate tables and constraints from the active cleaned versions.', action: 'Open Schema', route: `/projects/${this.projectId}/schema-designer` };
    if (dataset.status.toLocaleLowerCase() !== 'analyzed') return { title: 'Analyze your project data to discover its structure and quality.', description: 'Review every project dataset together or inspect one source.', action: 'Open Project Analysis', route: `/projects/${this.projectId}/analysis` };
    if (!overview?.generatedSchemasCount) return { title: 'Review and clean analyzed project data.', description: 'Preview versioned fixes before continuing to schema design.', action: 'Open Data Cleaning', route: `/projects/${this.projectId}/data-cleaning` };
    return { title: 'Review table relationships.', description: 'Confirm how the project tables connect before export.', action: 'Review Relationships', route: `/projects/${this.projectId}/relationships` };
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }
}
