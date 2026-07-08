import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, finalize, map, of, switchMap } from 'rxjs';
import { ApiErrorBody, ProjectRelationshipSuggestion, RelationshipSuggestion } from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';
import { DesignStateService } from '../../services/design-state.service';
import { mapSuggestion } from '../../services/design-view-model';
import { WorkflowStateService } from '../../services/workflow-state.service';

interface RelationshipDraft {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  relationshipType: string;
}

@Component({
  selector: 'app-project-relationships',
  standalone: true,
  imports: [FormsModule, NgClass, RouterLink],
  templateUrl: './project-relationships.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectRelationshipsComponent implements OnInit {
  readonly suggestions = signal<ProjectRelationshipSuggestion[]>([]);
  readonly loading = signal(false);
  readonly savingId = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly draft = signal<RelationshipDraft | null>(null);

  projectId = 0;
  errorMessage = '';
  successMessage = '';

  constructor(
    private designApi: DesignApiService,
    private designState: DesignStateService,
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

    this.designApi.getSuggestions(this.projectId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (suggestions) => this.suggestions.set(suggestions.map(mapSuggestion)),
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load relationship suggestions.';
        },
      });
  }

  accept(suggestion: ProjectRelationshipSuggestion): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.savingId.set(suggestion.suggestionId);

    this.currentDesignRevision()
      .pipe(
        switchMap((revision) => this.designApi.acceptSuggestion(Number(suggestion.suggestionId), revision)),
        finalize(() => this.savingId.set(null)),
      )
      .subscribe({
        next: (response) => {
          this.applyUpdatedSuggestion(response.suggestion);
          this.successMessage = 'Relationship accepted.';
        },
        error: (error: unknown) => this.handleDecisionError(error),
      });
  }

  reject(suggestion: ProjectRelationshipSuggestion): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.savingId.set(suggestion.suggestionId);

    this.designApi.rejectSuggestion(Number(suggestion.suggestionId))
      .pipe(finalize(() => this.savingId.set(null)))
      .subscribe({
        next: (updated) => {
          this.applyUpdatedSuggestion(updated);
          this.successMessage = 'Relationship rejected.';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to save relationship decision.';
        },
      });
  }

  startEdit(suggestion: ProjectRelationshipSuggestion): void {
    this.editingId.set(suggestion.suggestionId);
    this.draft.set({
      fromTable: suggestion.fromTable,
      fromColumn: suggestion.fromColumn,
      toTable: suggestion.toTable,
      toColumn: suggestion.toColumn,
      relationshipType: suggestion.relationshipType,
    });
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.draft.set(null);
  }

  /**
   * Accepting a suggestion always links the columns it was detected against — the accept
   * endpoint does not support re-pointing a suggestion at different columns, so edits to the
   * From/To table or column fields are not applied. Only an edited relationship type (cardinality)
   * is honored, via a follow-up PATCH once the relationship exists.
   */
  acceptEdited(suggestion: ProjectRelationshipSuggestion): void {
    const draft = this.draft();
    if (!draft) {
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';
    this.savingId.set(suggestion.suggestionId);

    this.currentDesignRevision()
      .pipe(
        switchMap((revision) => this.designApi.acceptSuggestion(Number(suggestion.suggestionId), revision)),
        switchMap((response) => {
          if (draft.relationshipType && draft.relationshipType !== response.relationship.cardinality) {
            return this.designApi
              .updateRelationship(response.relationship.id, response.designRevision, {
                cardinality: draft.relationshipType,
                onDelete: response.relationship.onDelete,
              })
              .pipe(map(() => response));
          }

          return of(response);
        }),
        finalize(() => this.savingId.set(null)),
      )
      .subscribe({
        next: (response) => {
          this.applyUpdatedSuggestion(response.suggestion);
          this.successMessage = 'Relationship accepted.';
        },
        error: (error: unknown) => this.handleDecisionError(error),
      });

    this.cancelEdit();
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

  confidenceWidth(suggestion: ProjectRelationshipSuggestion): number {
    const normalized = suggestion.confidence <= 1 ? suggestion.confidence * 100 : suggestion.confidence;
    return Math.max(0, Math.min(100, Math.round(normalized)));
  }

  confidenceClass(suggestion: ProjectRelationshipSuggestion): string {
    const confidence = this.confidenceWidth(suggestion);
    if (confidence >= 80) {
      return 'bg-emerald-500';
    }

    if (confidence >= 55) {
      return 'bg-amber-500';
    }

    return 'bg-rose-500';
  }

  private applyUpdatedSuggestion(updated: RelationshipSuggestion): void {
    const mapped = mapSuggestion(updated);
    this.suggestions.update((list) => list.map((item) => (item.suggestionId === mapped.suggestionId ? mapped : item)));
  }

  /** Accept requires If-Match with the current design revision. Reuses DesignStateService's
   * already-loaded copy when it's fresh for this project (e.g. the user was just on the Schema
   * Designer page); otherwise fetches the design once to read its revision. */
  private currentDesignRevision(): Observable<number> {
    const loaded = this.designState.design();
    if (loaded && loaded.projectId === this.projectId) {
      return of(loaded.revision);
    }

    return this.designApi.getDesign(this.projectId).pipe(map((design) => design.revision));
  }

  /** A 409/428 here means the design changed elsewhere since the revision above was read. Per
   * the conflict contract, this refreshes state but never automatically resends the decision —
   * the user must explicitly retry (e.g. click Accept again) once they've reviewed the queue. */
  private handleDecisionError(error: unknown): void {
    const status = (error as { status?: number } | null)?.status;

    if (status === 409 || status === 428) {
      this.errorMessage = 'This design changed elsewhere. The queue has been refreshed — review it and try again.';
      this.loadSuggestions();

      if (this.designState.design()?.projectId === this.projectId) {
        this.designState.reload().subscribe();
      }

      return;
    }

    this.errorMessage = (error as { error?: ApiErrorBody } | null)?.error?.message ?? 'Unable to save relationship decision.';
  }
}
