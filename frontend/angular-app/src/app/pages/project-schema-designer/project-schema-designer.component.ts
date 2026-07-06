import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectRelationshipSuggestion, ProjectSchema } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-project-schema-designer',
  standalone: true,
  templateUrl: './project-schema-designer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectSchemaDesignerComponent implements OnInit {
  readonly schema = signal<ProjectSchema | null>(null);
  readonly loading = signal(false);
  readonly generating = signal(false);
  readonly activePreview = signal<'sql' | 'dbml' | 'json'>('sql');
  readonly copied = signal(false);

  projectId = 0;
  errorMessage = '';
  successMessage = '';

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
    this.loadSchema();
  }

  loadSchema(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getProjectSchema(this.projectId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (schema) => this.schema.set(schema),
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load project schema.';
        },
      });
  }

  generateSchema(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.generating.set(true);

    this.api.generateProjectSchema(this.projectId)
      .pipe(finalize(() => this.generating.set(false)))
      .subscribe({
        next: (schema) => {
          this.schema.set(schema);
          this.successMessage = 'Project schema generated.';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to generate project schema.';
        },
      });
  }

  previewText(schema: ProjectSchema): string {
    if (this.activePreview() === 'dbml') {
      return schema.dbmlPreview;
    }

    if (this.activePreview() === 'json') {
      return schema.jsonPreview;
    }

    return schema.sqlPreview;
  }

  relationshipLabel(relationship: ProjectRelationshipSuggestion): string {
    return `${relationship.fromTable}.${relationship.fromColumn} \u2192 ${relationship.toTable}.${relationship.toColumn}`;
  }

  copyPreview(schema: ProjectSchema): void {
    navigator.clipboard.writeText(this.previewText(schema))
      .then(() => {
        this.copied.set(true);
        window.setTimeout(() => this.copied.set(false), 2000);
      })
      .catch(() => {
        this.errorMessage = 'Unable to copy in this browser.';
      });
  }
}
