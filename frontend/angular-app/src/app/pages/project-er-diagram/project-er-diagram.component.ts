import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectRelationshipSuggestion, ProjectSchema } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-project-er-diagram',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './project-er-diagram.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectErDiagramComponent implements OnInit {
  readonly schema = signal<ProjectSchema | null>(null);
  readonly loading = signal(false);

  projectId = 0;
  errorMessage = '';

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
          this.errorMessage = error.error?.message ?? 'Unable to load ER diagram.';
        },
      });
  }

  relationshipLabel(relationship: ProjectRelationshipSuggestion): string {
    return `${relationship.fromTable}.${relationship.fromColumn} \u2192 ${relationship.toTable}.${relationship.toColumn}`;
  }
}
