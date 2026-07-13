import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, finalize, forkJoin, map, of, switchMap } from 'rxjs';
import {
  ApiErrorBody,
  DesignColumn,
  DesignModelResponse,
  DesignRelationship,
  DesignTable,
  ProjectRelationshipSuggestion,
  RelationshipSuggestion,
} from '../../services/api.models';
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
  readonly design = signal<DesignModelResponse | null>(null);
  readonly loading = signal(false);
  readonly detecting = signal(false);
  readonly savingId = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly draft = signal<RelationshipDraft | null>(null);
  readonly manualSaving = signal(false);
  readonly editingRelationshipId = signal<number | null>(null);
  readonly relationshipDraft = signal<{ cardinality: string; onDelete: string } | null>(null);

  projectId = 0;
  errorMessage = '';
  successMessage = '';
  manualFromTableId: number | null = null;
  manualFromColumnId: number | null = null;
  manualToTableId: number | null = null;
  manualToColumnId: number | null = null;
  manualCardinality = 'many-to-one';
  manualOnDelete = 'no-action';

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

    forkJoin({
      suggestions: this.designApi.getSuggestions(this.projectId),
      design: this.designApi.getDesign(this.projectId),
    })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ suggestions, design }) => {
          this.suggestions.set(suggestions.map(mapSuggestion));
          this.design.set(design);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load relationships and schema tables.';
        },
      });
  }

  detectRelationships(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.detecting.set(true);

    this.designApi.detectSuggestions(this.projectId)
      .pipe(finalize(() => this.detecting.set(false)))
      .subscribe({
        next: (suggestions) => {
          this.suggestions.set(suggestions.map(mapSuggestion));
          this.successMessage = suggestions.length > 0
            ? `Detected ${suggestions.length} relationship suggestion(s).`
            : 'No new relationship suggestions were detected from the current datasets.';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to detect relationships.';
        },
      });
  }

  accept(suggestion: ProjectRelationshipSuggestion): void {
    const unavailable = this.suggestionUnavailableReason(suggestion);
    if (unavailable) {
      this.errorMessage = unavailable;
      return;
    }

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
          this.applyAcceptedRelationship(response.relationship, response.designRevision);
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
          this.applyAcceptedRelationship(response.relationship, response.designRevision);
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

  tables(): DesignTable[] {
    return this.design()?.tables ?? [];
  }

  persistedRelationships(): DesignRelationship[] {
    return this.design()?.relationships ?? [];
  }

  sourceColumns(): DesignColumn[] {
    return this.tableById(this.manualFromTableId)?.columns ?? [];
  }

  targetColumns(): DesignColumn[] {
    return this.tableById(this.manualToTableId)?.columns ?? [];
  }

  onSourceTableChange(): void {
    this.manualFromColumnId = null;
    this.manualToColumnId = null;
    this.clearMessages();
  }

  onTargetTableChange(): void {
    this.manualToColumnId = null;
    this.clearMessages();
  }

  onManualEndpointChange(): void {
    this.clearMessages();
    const target = this.selectedTargetColumn();
    if (target && this.targetColumnDisabled(target)) {
      this.manualToColumnId = null;
    }
  }

  targetColumnBadges(column: DesignColumn): string {
    return [column.isPrimaryKey ? 'PK' : '', column.isUnique ? 'Unique' : ''].filter(Boolean).join(' + ');
  }

  targetColumnDisabled(column: DesignColumn): boolean {
    const source = this.selectedSourceColumn();
    return (!column.isPrimaryKey && !column.isUnique)
      || column.id === source?.id
      || (!!source && !this.compatibleTypes(source.sqlType, column.sqlType));
  }

  targetColumnReason(column: DesignColumn): string {
    if (!column.isPrimaryKey && !column.isUnique) return 'not a PK or Unique column';
    const source = this.selectedSourceColumn();
    if (source?.id === column.id) return 'same as source';
    if (source && !this.compatibleTypes(source.sqlType, column.sqlType)) return `type mismatch (${column.sqlType})`;
    return this.targetColumnBadges(column);
  }

  manualValidationMessage(): string {
    if (!this.design()) return 'Generate a schema before creating relationships.';
    if (!this.manualFromTableId || !this.manualFromColumnId || !this.manualToTableId || !this.manualToColumnId) {
      return 'Select a source table and column, then a PK or Unique target.';
    }
    const source = this.selectedSourceColumn();
    const target = this.selectedTargetColumn();
    if (!source || !target) return 'Select persisted source and target columns.';
    if (source.id === target.id) return 'Source and target cannot be the same endpoint.';
    if (!target.isPrimaryKey && !target.isUnique) return 'Target must be a Primary Key or Unique column.';
    if (!this.compatibleTypes(source.sqlType, target.sqlType)) return `Column types must match (${source.sqlType} vs ${target.sqlType}).`;
    if (this.manualDuplicate()) return 'This exact relationship already exists.';
    return '';
  }

  canCreateManual(): boolean {
    return !this.manualSaving() && this.manualValidationMessage() === '';
  }

  createManualRelationship(): void {
    const design = this.design();
    const validation = this.manualValidationMessage();
    if (!design || validation) {
      this.errorMessage = validation || 'No schema design is loaded.';
      return;
    }

    this.clearMessages();
    this.manualSaving.set(true);
    this.designApi.createRelationship(design.id, design.revision, {
      fromColumnId: this.manualFromColumnId!,
      toColumnId: this.manualToColumnId!,
      cardinality: this.manualCardinality,
      onDelete: this.manualOnDelete,
    }).pipe(finalize(() => this.manualSaving.set(false))).subscribe({
      next: (updated) => {
        this.design.set(updated);
        this.designState.loadForProject(this.projectId).subscribe();
        this.resetManualForm();
        this.successMessage = 'Manual relationship created. Schema status returned to Draft.';
      },
      error: (error: { error?: ApiErrorBody }) => {
        this.errorMessage = error.error?.message ?? 'Unable to create the relationship.';
      },
    });
  }

  resetManualForm(): void {
    this.manualFromTableId = null;
    this.manualFromColumnId = null;
    this.manualToTableId = null;
    this.manualToColumnId = null;
    this.manualCardinality = 'many-to-one';
    this.manualOnDelete = 'no-action';
    this.clearMessages();
  }

  startRelationshipEdit(relationship: DesignRelationship): void {
    this.editingRelationshipId.set(relationship.id);
    this.relationshipDraft.set({ cardinality: relationship.cardinality, onDelete: relationship.onDelete });
  }

  cancelRelationshipEdit(): void {
    this.editingRelationshipId.set(null);
    this.relationshipDraft.set(null);
  }

  saveRelationshipEdit(relationship: DesignRelationship): void {
    const design = this.design();
    const draft = this.relationshipDraft();
    if (!design || !draft) return;
    const duplicate = design.relationships.some(item => item.id !== relationship.id
      && item.fromColumnId === relationship.fromColumnId
      && item.toColumnId === relationship.toColumnId
      && item.cardinality === draft.cardinality);
    if (duplicate) {
      this.errorMessage = 'Updating this relationship would create an exact duplicate.';
      return;
    }

    this.manualSaving.set(true);
    this.designApi.updateRelationship(relationship.id, design.revision, draft)
      .pipe(finalize(() => this.manualSaving.set(false)))
      .subscribe({
        next: (updated) => {
          this.design.set(updated);
          this.cancelRelationshipEdit();
          this.successMessage = 'Relationship updated.';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to update the relationship.';
        },
      });
  }

  deleteRelationship(relationship: DesignRelationship): void {
    const design = this.design();
    if (!design) return;
    this.manualSaving.set(true);
    this.designApi.deleteRelationship(relationship.id, design.revision)
      .pipe(finalize(() => this.manualSaving.set(false)))
      .subscribe({
        next: (updated) => {
          this.design.set(updated);
          this.successMessage = 'Relationship deleted.';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to delete the relationship.';
        },
      });
  }

  suggestionUnavailableReason(suggestion: ProjectRelationshipSuggestion): string {
    const source = this.findSuggestionColumn(suggestion.fromDatasetId, suggestion.fromColumn);
    const target = this.findSuggestionColumn(suggestion.toDatasetId, suggestion.toColumn);
    if (!source || !target) return 'This suggestion no longer maps to persisted schema columns.';
    if (!target.isPrimaryKey && !target.isUnique) {
      return `Target ${suggestion.toTable}.${target.name} is unavailable because it is neither Primary Key nor Unique.`;
    }
    if (!this.compatibleTypes(source.sqlType, target.sqlType)) {
      return `Source and target types do not match (${source.sqlType} vs ${target.sqlType}).`;
    }
    if (this.design()?.relationships.some(item => item.fromColumnId === source.id
      && item.toColumnId === target.id && item.cardinality === 'many-to-one')) {
      return 'This exact relationship already exists.';
    }
    return '';
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

  private applyAcceptedRelationship(relationship: DesignRelationship, revision: number): void {
    this.design.update((current) => current ? {
      ...current,
      revision,
      status: 'Draft',
      validatedAt: null,
      relationships: current.relationships.some(item => item.id === relationship.id)
        ? current.relationships
        : [...current.relationships, relationship],
    } : current);
  }

  private tableById(tableId: number | null): DesignTable | undefined {
    return this.tables().find(table => table.id === tableId);
  }

  private selectedSourceColumn(): DesignColumn | undefined {
    return this.sourceColumns().find(column => column.id === this.manualFromColumnId);
  }

  private selectedTargetColumn(): DesignColumn | undefined {
    return this.targetColumns().find(column => column.id === this.manualToColumnId);
  }

  private manualDuplicate(): boolean {
    return !!this.design()?.relationships.some(item => item.fromColumnId === this.manualFromColumnId
      && item.toColumnId === this.manualToColumnId && item.cardinality === this.manualCardinality);
  }

  private findSuggestionColumn(datasetId: number, sourceColumnName: string): DesignColumn | undefined {
    return this.design()?.tables
      .find(table => table.sourceDatasetId === datasetId)
      ?.columns.find(column => (column.sourceColumnName ?? column.name) === sourceColumnName);
  }

  private compatibleTypes(left: string, right: string): boolean {
    const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toUpperCase()
      .replace('TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ');
    return normalize(left) === normalize(right);
  }

  private clearMessages(): void {
    this.errorMessage = '';
    this.successMessage = '';
  }

  /** Accept requires If-Match with the current design revision. Reuses DesignStateService's
   * already-loaded copy when it's fresh for this project (e.g. the user was just on the Schema
   * Designer page); otherwise fetches the design once to read its revision. */
  private currentDesignRevision(): Observable<number> {
    const local = this.design();
    if (local) {
      return of(local.revision);
    }
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
    const body = (error as { error?: ApiErrorBody & { currentRevision?: number } } | null)?.error;

    if (status === 428 || (status === 409 && typeof body?.currentRevision === 'number')) {
      // loadSuggestions() clears errorMessage synchronously as soon as it's called (before its
      // HTTP response arrives), so it must run first — otherwise it immediately wipes out the
      // conflict message this method is trying to show.
      this.loadSuggestions();
      this.errorMessage = 'This design changed elsewhere. The queue has been refreshed — review it and try again.';

      if (this.designState.design()?.projectId === this.projectId) {
        this.designState.reload().subscribe();
      }

      return;
    }

    this.errorMessage = body?.message ?? 'Unable to save relationship decision.';
  }
}
