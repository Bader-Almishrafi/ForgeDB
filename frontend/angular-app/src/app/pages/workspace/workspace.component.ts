import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, of } from 'rxjs';
import { ApiErrorBody, DatasetResponse, ProjectResponse, SchemaResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

type WorkspaceStep = 'project' | 'upload' | 'preview' | 'analyze' | 'dashboard' | 'schema' | 'er' | 'relationships' | 'deploy';

interface RelationshipReadinessItem {
  columnName: string;
  reason: string;
  datasets: Array<{ id: number; tableName: string }>;
}

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './workspace.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceComponent implements OnInit {
  readonly project = signal<ProjectResponse | null>(null);
  readonly datasets = signal<DatasetResponse[]>([]);
  readonly currentDataset = signal<DatasetResponse | null>(null);
  readonly schema = signal<SchemaResponse | null>(null);
  readonly schemaByDataset = signal<Record<number, SchemaResponse | null>>({});
  readonly columnsByDataset = signal<Record<number, string[]>>({});
  readonly loading = signal(false);

  projectId = 0;
  errorMessage = '';
  readonly workflowSteps: Array<{ key: WorkspaceStep; label: string }> = [
    { key: 'project', label: 'Project' },
    { key: 'upload', label: 'Upload' },
    { key: 'preview', label: 'Preview' },
    { key: 'analyze', label: 'Analyze' },
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'schema', label: 'Schema' },
    { key: 'er', label: 'ER Diagram' },
    { key: 'relationships', label: 'Relationships' },
    { key: 'deploy', label: 'Deployment' },
  ];

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

    this.workflow.setProjectId(this.projectId);
    this.loadWorkspace();
  }

  loadWorkspace(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getProject(this.projectId).subscribe({
      next: (project) => {
        this.project.set(project);
        this.workflow.setProject(project);
      },
      error: (error: { error?: ApiErrorBody }) => {
        this.errorMessage = error.error?.message ?? 'Unable to load project.';
      },
    });

    this.api.getProjectDatasets(this.projectId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (datasets) => {
          this.datasets.set(datasets);
          const rememberedDataset = datasets.find((dataset) => dataset.id === this.workflow.datasetId());
          const selectedDataset = rememberedDataset ?? datasets[0] ?? null;
          this.currentDataset.set(selectedDataset);
          this.loadDatasetMetadata(datasets);

          if (selectedDataset) {
            this.workflow.setDataset(selectedDataset);
            this.loadDatasetSchema(selectedDataset.id, true);
          } else {
            this.schema.set(null);
          }
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load datasets.';
        },
      });
  }

  selectDataset(dataset: DatasetResponse): void {
    this.currentDataset.set(dataset);
    this.workflow.setDataset(dataset);
    this.loadDatasetSchema(dataset.id, true);
  }

  workspaceStepState(step: WorkspaceStep): 'done' | 'active' | 'locked' {
    if (step === 'project') {
      return 'done';
    }

    if (step === 'upload' || step === 'preview') {
      return this.currentDataset() ? 'done' : 'active';
    }

    if (step === 'analyze' || step === 'dashboard') {
      const dataset = this.currentDataset();
      if (!dataset) {
        return 'locked';
      }

      return dataset.status === 'Analyzed' ? 'done' : 'active';
    }

    if (step === 'schema') {
      if (!this.currentDataset()) {
        return 'locked';
      }

      return this.schema() ? 'done' : 'active';
    }

    if (step === 'er' || step === 'relationships') {
      return this.schema() ? 'done' : 'locked';
    }

    return this.schema() ? 'active' : 'locked';
  }

  nextRecommendedStep(): string {
    if (!this.currentDataset()) {
      return 'Upload a CSV dataset';
    }

    if (this.currentDataset()?.status !== 'Analyzed') {
      return 'Run dataset analysis';
    }

    if (!this.schema()) {
      return 'Generate and review the schema';
    }

    return 'Generate the final database package';
  }

  schemaForDataset(dataset: DatasetResponse): SchemaResponse | null {
    return this.schemaByDataset()[dataset.id] ?? null;
  }

  schemaActionLabel(dataset: DatasetResponse): string {
    return this.schemaForDataset(dataset) ? 'View Schema' : 'Generate Schema';
  }

  schemaQueryParams(dataset: DatasetResponse): Record<string, number> | null {
    const schema = this.schemaForDataset(dataset);
    return schema ? { schemaId: schema.schemaId } : null;
  }

  isSelectedDataset(dataset: DatasetResponse): boolean {
    return this.currentDataset()?.id === dataset.id;
  }

  datasetStatusClass(dataset: DatasetResponse): string {
    return dataset.status === 'Analyzed' ? 'badge-success' : 'badge-warning';
  }

  relationshipReadiness(): RelationshipReadinessItem[] {
    const datasets = this.datasets();
    const columnsByDataset = this.columnsByDataset();
    const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]));
    const columnMap = new Map<string, { displayName: string; datasetIds: Set<number>; keyLike: boolean }>();

    Object.entries(columnsByDataset).forEach(([datasetIdText, columns]) => {
      const datasetId = Number(datasetIdText);
      columns.forEach((columnName) => {
        const normalized = columnName.toLowerCase();
        const entry = columnMap.get(normalized) ?? {
          displayName: columnName,
          datasetIds: new Set<number>(),
          keyLike: this.isKeyLikeColumn(columnName),
        };
        entry.datasetIds.add(datasetId);
        entry.keyLike = entry.keyLike || this.isKeyLikeColumn(columnName);
        columnMap.set(normalized, entry);
      });
    });

    return Array.from(columnMap.values())
      .filter((entry) => entry.keyLike || entry.datasetIds.size > 1)
      .map((entry) => {
        const matchedDatasets = Array.from(entry.datasetIds)
          .map((datasetId) => datasetById.get(datasetId))
          .filter((dataset): dataset is DatasetResponse => Boolean(dataset))
          .map((dataset) => ({ id: dataset.id, tableName: dataset.tableName }));

        return {
          columnName: entry.displayName,
          reason: entry.datasetIds.size > 1
            ? 'Matching column name appears in multiple datasets.'
            : 'Key-like column name is ready for relationship review.',
          datasets: matchedDatasets,
        };
      })
      .sort((left, right) => right.datasets.length - left.datasets.length || left.columnName.localeCompare(right.columnName))
      .slice(0, 8);
  }

  private loadDatasetMetadata(datasets: DatasetResponse[]): void {
    datasets.forEach((dataset) => {
      this.loadDatasetSchema(dataset.id, false);
      this.loadDatasetColumns(dataset);
    });
  }

  private loadDatasetSchema(datasetId: number, updateCurrent: boolean): void {
    const knownSchemas = this.schemaByDataset();
    if (Object.prototype.hasOwnProperty.call(knownSchemas, datasetId)) {
      if (updateCurrent) {
        this.setCurrentSchema(knownSchemas[datasetId]);
      }
      return;
    }

    this.api.getDatasetSchema(datasetId)
      .pipe(catchError(() => of(null)))
      .subscribe((schema) => {
        this.schemaByDataset.update((schemas) => ({ ...schemas, [datasetId]: schema }));
        if (updateCurrent) {
          this.setCurrentSchema(schema);
        }
      });
  }

  private loadDatasetColumns(dataset: DatasetResponse): void {
    if (this.columnsByDataset()[dataset.id]) {
      return;
    }

    this.api.getDatasetPreview(dataset.id)
      .pipe(catchError(() => of(null)))
      .subscribe((preview) => {
        this.columnsByDataset.update((columns) => ({
          ...columns,
          [dataset.id]: preview?.columns ?? [],
        }));
      });
  }

  private setCurrentSchema(schema: SchemaResponse | null): void {
    this.schema.set(schema);
    if (schema) {
      this.workflow.setSchema(schema);
    } else {
      this.workflow.clearSchema();
    }
  }

  private isKeyLikeColumn(columnName: string): boolean {
    const normalized = columnName.toLowerCase();
    return normalized === 'id' || normalized.endsWith('_id') || normalized.endsWith('id');
  }
}
