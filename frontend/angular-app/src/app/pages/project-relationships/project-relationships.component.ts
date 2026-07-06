import { PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectRelationshipSuggestion } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-project-relationships',
  standalone: true,
  imports: [PercentPipe, RouterLink],
  templateUrl: './project-relationships.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectRelationshipsComponent implements OnInit {
  readonly suggestions = signal<ProjectRelationshipSuggestion[]>([]);
  readonly loading = signal(false);
  readonly savingId = signal<string | null>(null);

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
    this.loadSuggestions();
  }

  loadSuggestions(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getProjectRelationshipSuggestions(this.projectId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (suggestions) => this.suggestions.set(suggestions),
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load relationship suggestions.';
        },
      });
  }

  accept(suggestion: ProjectRelationshipSuggestion): void {
    this.saveDecision(suggestion, true);
  }

  reject(suggestion: ProjectRelationshipSuggestion): void {
    this.saveDecision(suggestion, false);
  }

  accepted(): ProjectRelationshipSuggestion[] {
    return this.suggestions().filter((suggestion) => suggestion.status === 'accepted');
  }

  rejected(): ProjectRelationshipSuggestion[] {
    return this.suggestions().filter((suggestion) => suggestion.status === 'rejected');
  }

  pending(): ProjectRelationshipSuggestion[] {
    return this.suggestions().filter((suggestion) => suggestion.status !== 'accepted' && suggestion.status !== 'rejected');
  }

  relationshipLabel(suggestion: ProjectRelationshipSuggestion): string {
    return `${suggestion.fromTable}.${suggestion.fromColumn} \u2192 ${suggestion.toTable}.${suggestion.toColumn}`;
  }

  private saveDecision(suggestion: ProjectRelationshipSuggestion, accept: boolean): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.savingId.set(suggestion.suggestionId);
    const request = accept
      ? this.api.acceptProjectRelationship(this.projectId, suggestion)
      : this.api.rejectProjectRelationship(this.projectId, suggestion);

    request.pipe(finalize(() => this.savingId.set(null)))
      .subscribe({
        next: (suggestions) => {
          this.suggestions.set(suggestions);
          this.successMessage = accept ? 'Relationship accepted.' : 'Relationship rejected.';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to save relationship decision.';
        },
      });
  }
}
