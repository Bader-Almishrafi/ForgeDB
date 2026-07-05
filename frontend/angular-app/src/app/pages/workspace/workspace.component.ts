import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, DatasetResponse, ProjectResponse, SchemaResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

type WorkspaceStep = 'project' | 'upload' | 'preview' | 'analyze' | 'dashboard' | 'schema' | 'er' | 'relationships' | 'deploy';

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

          if (selectedDataset) {
            this.workflow.setDataset(selectedDataset);
          }

          this.loadSchemaIfKnown();
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load datasets.';
        },
      });
  }

  selectDataset(dataset: DatasetResponse): void {
    this.currentDataset.set(dataset);
    this.workflow.setDataset(dataset);
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

  private loadSchemaIfKnown(): void {
    const schemaId = this.workflow.schemaId();
    if (!schemaId) {
      this.schema.set(null);
      return;
    }

    this.api.getSchema(schemaId).subscribe({
      next: (schema) => {
        this.schema.set(schema);
        this.workflow.setSchema(schema);
      },
      error: () => {
        this.schema.set(null);
        this.workflow.clearSchema();
      },
    });
  }
}
