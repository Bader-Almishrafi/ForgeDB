import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, finalize, forkJoin, switchMap } from 'rxjs';
import {
  AcceptSuggestionRequest,
  ApiErrorBody,
  DesignColumn,
  DesignModelResponse,
  DesignRelationship,
  DesignTable,
  RelationshipSuggestion,
} from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';

type FeedbackKind = 'success' | 'warning' | 'error';

interface Feedback {
  kind: FeedbackKind;
  title: string;
  message: string;
}

interface RelationshipDraft {
  fromTableId: number | null;
  fromColumnId: number | null;
  toTableId: number | null;
  toColumnId: number | null;
  cardinality: string;
  onDelete: string;
}

const emptyDraft = (): RelationshipDraft => ({
  fromTableId: null,
  fromColumnId: null,
  toTableId: null,
  toColumnId: null,
  cardinality: 'many-to-one',
  onDelete: 'no-action',
});

@Component({
  selector: 'app-schema-relationships',
  standalone: true,
  imports: [FormsModule, NgClass],
  templateUrl: './schema-relationships.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchemaRelationshipsComponent implements OnInit {
  readonly projectId = input.required<number>();
  readonly design = input.required<DesignModelResponse>();
  readonly disabled = input(false);
  readonly designChanged = output<DesignModelResponse>();
  readonly revisionConflict = output<void>();

  readonly suggestions = signal<RelationshipSuggestion[]>([]);
  readonly loading = signal(true);
  readonly busyAction = signal<string | null>(null);
  readonly feedback = signal<Feedback | null>(null);
  readonly editingSuggestionId = signal<number | null>(null);
  readonly suggestionDraft = signal<RelationshipDraft | null>(null);
  readonly manualDraft = signal<RelationshipDraft>(emptyDraft());
  readonly editingRelationshipId = signal<number | null>(null);
  readonly relationshipDraft = signal<{ cardinality: string; onDelete: string } | null>(null);
  readonly deleteTarget = signal<DesignRelationship | null>(null);

  readonly pendingSuggestions = computed(() => this.suggestions().filter((item) => item.status === 'suggested'));
  readonly tables = computed(() => this.design().tables);
  readonly persistedRelationships = computed(() => this.design().relationships);

  constructor(private readonly designApi: DesignApiService) {}

  ngOnInit(): void {
    this.reloadSuggestions();
  }

  reloadSuggestions(): void {
    this.loading.set(true);
    this.designApi.getSuggestions(this.projectId()).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (suggestions) => this.suggestions.set(suggestions),
      error: (error) => this.showError(error, 'Relationship suggestions unavailable'),
    });
  }

  detectRelationships(): void {
    this.runMutation(
      'detect',
      () => this.designApi.detectSuggestions(this.projectId()),
      'Relationship detection complete',
      'Review the pending suggestions before accepting them.',
    );
  }

  acceptSuggestion(suggestion: RelationshipSuggestion): void {
    const draft = this.draftForSuggestion(suggestion);
    const validation = this.validateDraft(draft, true);
    if (validation) {
      this.feedback.set({ kind: 'warning', title: 'Edit required', message: validation });
      return;
    }
    this.submitSuggestion(suggestion, draft, false);
  }

  startSuggestionEdit(suggestion: RelationshipSuggestion): void {
    this.editingSuggestionId.set(suggestion.id);
    this.suggestionDraft.set(this.draftForSuggestion(suggestion));
    this.feedback.set(null);
  }

  closeSuggestionEditor(): void {
    this.editingSuggestionId.set(null);
    this.suggestionDraft.set(null);
  }

  updateSuggestionDraft(patch: Partial<RelationshipDraft>): void {
    const current = this.suggestionDraft();
    if (current) this.suggestionDraft.set(this.applyDraftPatch(current, patch));
  }

  acceptEditedSuggestion(suggestion: RelationshipSuggestion): void {
    const draft = this.suggestionDraft();
    if (!draft) return;
    const validation = this.validateDraft(draft, true);
    if (validation) {
      this.feedback.set({ kind: 'error', title: 'Relationship is invalid', message: validation });
      return;
    }
    this.submitSuggestion(suggestion, draft, true);
  }

  rejectSuggestion(suggestion: RelationshipSuggestion): void {
    this.runMutation(
      `reject:${suggestion.id}`,
      () => this.designApi.rejectSuggestion(suggestion.id),
      'Suggestion rejected',
      'No relationship was persisted.',
      () => this.closeSuggestionEditor(),
    );
  }

  updateManualDraft(patch: Partial<RelationshipDraft>): void {
    this.manualDraft.set(this.applyDraftPatch(this.manualDraft(), patch));
    this.feedback.set(null);
  }

  clearManualForm(): void {
    this.manualDraft.set(emptyDraft());
    this.feedback.set(null);
  }

  createManualRelationship(): void {
    const draft = this.manualDraft();
    const validation = this.validateDraft(draft);
    if (validation) {
      this.feedback.set({ kind: 'error', title: 'Relationship is invalid', message: validation });
      return;
    }
    this.runMutation(
      'create',
      () => this.designApi.createRelationship(this.design().id, this.design().revision, this.toRequest(draft)),
      'Relationship created',
      'Validate the schema again before export or deployment.',
      () => this.manualDraft.set(emptyDraft()),
    );
  }

  startRelationshipEdit(relationship: DesignRelationship): void {
    this.editingRelationshipId.set(relationship.id);
    this.relationshipDraft.set({ cardinality: relationship.cardinality, onDelete: relationship.onDelete });
    this.feedback.set(null);
  }

  cancelRelationshipEdit(): void {
    this.editingRelationshipId.set(null);
    this.relationshipDraft.set(null);
  }

  updateRelationshipDraft(patch: Partial<{ cardinality: string; onDelete: string }>): void {
    const current = this.relationshipDraft();
    if (current) this.relationshipDraft.set({ ...current, ...patch });
  }

  saveRelationshipEdit(relationship: DesignRelationship): void {
    const draft = this.relationshipDraft();
    if (!draft) return;
    const duplicate = this.design().relationships.some((item) => item.id !== relationship.id
      && item.fromColumnId === relationship.fromColumnId
      && item.toColumnId === relationship.toColumnId
      && item.cardinality === draft.cardinality);
    if (duplicate) {
      this.feedback.set({ kind: 'error', title: 'Duplicate relationship', message: 'This relationship already exists.' });
      return;
    }
    this.runMutation(
      `edit:${relationship.id}`,
      () => this.designApi.updateRelationship(relationship.id, this.design().revision, draft),
      'Relationship updated',
      'Validate the schema again before export or deployment.',
      () => this.cancelRelationshipEdit(),
    );
  }

  requestDelete(relationship: DesignRelationship): void {
    this.deleteTarget.set(relationship);
  }

  cancelDelete(): void {
    if (!this.busyAction()?.startsWith('delete:')) this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const relationship = this.deleteTarget();
    if (!relationship) return;
    this.runMutation(
      `delete:${relationship.id}`,
      () => this.designApi.deleteRelationship(relationship.id, this.design().revision),
      'Relationship deleted',
      'The backend SQL preview has been refreshed. Validate the schema again.',
      () => {
        this.deleteTarget.set(null);
        this.cancelRelationshipEdit();
      },
    );
  }

  columnsFor(tableId: number | null): DesignColumn[] {
    return this.tableById(tableId)?.columns ?? [];
  }

  targetColumnDisabled(draft: RelationshipDraft, column: DesignColumn): boolean {
    const source = this.columnInTable(draft.fromTableId, draft.fromColumnId);
    return (!column.isPrimaryKey && !column.isUnique)
      || column.id === source?.id
      || (!!source && !this.compatibleTypes(source.sqlType, column.sqlType));
  }

  manualValidationMessage(): string {
    return this.validateDraft(this.manualDraft());
  }

  suggestionValidationMessage(): string {
    const draft = this.suggestionDraft();
    return draft ? this.validateDraft(draft, true) : '';
  }

  suggestionAvailabilityMessage(suggestion: RelationshipSuggestion): string {
    return this.validateDraft(this.draftForSuggestion(suggestion), true);
  }

  confidencePercent(suggestion: RelationshipSuggestion): number {
    const score = suggestion.score <= 1 ? suggestion.score * 100 : suggestion.score;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  confidenceClass(suggestion: RelationshipSuggestion): string {
    const confidence = this.confidencePercent(suggestion);
    return confidence >= 80 ? 'bg-emerald-500' : confidence >= 55 ? 'bg-amber-500' : 'bg-rose-500';
  }

  suggestionReasons(suggestion: RelationshipSuggestion): string[] {
    if (!suggestion.evidenceJson) return [];
    try {
      const value = JSON.parse(suggestion.evidenceJson) as { reasons?: unknown };
      return Array.isArray(value.reasons) ? value.reasons.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  suggestionReason(suggestion: RelationshipSuggestion): string {
    return this.suggestionReasons(suggestion)[0]
      ?? 'Compatible column structure indicates a likely foreign-key relationship.';
  }

  relationshipLabel(relationship: DesignRelationship): string {
    return `${relationship.fromTableName}.${relationship.fromColumnName} → ${relationship.toTableName}.${relationship.toColumnName}`;
  }

  cardinalityLabel(value: string): string {
    return value === 'one-to-one' ? 'One to one' : 'Many to one';
  }

  onDeleteLabel(value: string): string {
    return value === 'set-null' ? 'Set null' : value === 'cascade' ? 'Cascade' : 'No action';
  }

  isBusy(key?: string): boolean {
    return key ? this.busyAction() === key : this.busyAction() !== null;
  }

  private submitSuggestion(suggestion: RelationshipSuggestion, draft: RelationshipDraft, edited: boolean): void {
    this.runMutation(
      `accept:${suggestion.id}`,
      () => this.designApi.acceptSuggestion(suggestion.id, this.design().revision, this.toRequest(draft)),
      edited ? 'Edited suggestion accepted' : 'Suggestion accepted',
      'The relationship is persisted and the schema requires validation.',
      () => this.closeSuggestionEditor(),
    );
  }

  private runMutation<T>(key: string, request: () => Observable<T>, title: string, message: string, afterSuccess?: () => void): void {
    if (this.disabled() || this.busyAction()) return;
    this.feedback.set(null);
    this.busyAction.set(key);
    request().pipe(
      switchMap(() => forkJoin({
        design: this.designApi.getSchema(this.projectId()),
        suggestions: this.designApi.getSuggestions(this.projectId()),
      })),
      finalize(() => this.busyAction.set(null)),
    ).subscribe({
      next: ({ design, suggestions }) => {
        this.suggestions.set(suggestions);
        if (design) this.designChanged.emit(design);
        afterSuccess?.();
        this.feedback.set({ kind: 'success', title, message });
      },
      error: (error) => {
        if (this.designApi.isRevisionConflict(error)) {
          this.revisionConflict.emit();
          this.feedback.set({ kind: 'error', title: 'Schema changed elsewhere', message: 'Reload the latest schema before changing relationships.' });
          return;
        }
        this.showError(error, 'Relationship operation failed');
      },
    });
  }

  private draftForSuggestion(suggestion: RelationshipSuggestion): RelationshipDraft {
    const fromTable = this.tables().find((table) => table.sourceDatasetId === suggestion.sourceDatasetId);
    const toTable = this.tables().find((table) => table.sourceDatasetId === suggestion.targetDatasetId);
    const fromColumn = fromTable?.columns.find((column) => (column.sourceColumnName ?? column.name) === suggestion.sourceColumnName);
    const toColumn = toTable?.columns.find((column) => (column.sourceColumnName ?? column.name) === suggestion.targetColumnName);
    return {
      fromTableId: fromTable?.id ?? null,
      fromColumnId: fromColumn?.id ?? null,
      toTableId: toTable?.id ?? null,
      toColumnId: toColumn?.id ?? null,
      cardinality: 'many-to-one',
      onDelete: 'no-action',
    };
  }

  private applyDraftPatch(current: RelationshipDraft, patch: Partial<RelationshipDraft>): RelationshipDraft {
    const next = { ...current, ...patch };
    if ('fromTableId' in patch && patch.fromTableId !== current.fromTableId) {
      next.fromColumnId = null;
      next.toColumnId = null;
    }
    if ('fromColumnId' in patch && patch.fromColumnId !== current.fromColumnId) next.toColumnId = null;
    if ('toTableId' in patch && patch.toTableId !== current.toTableId) next.toColumnId = null;
    return next;
  }

  private validateDraft(draft: RelationshipDraft, allowExisting = false): string {
    if (!draft.fromTableId || !draft.fromColumnId || !draft.toTableId || !draft.toColumnId) return 'Select source and target tables and columns.';
    const source = this.columnInTable(draft.fromTableId, draft.fromColumnId);
    const target = this.columnInTable(draft.toTableId, draft.toColumnId);
    if (!source || !target) return 'Every endpoint must belong to the current schema.';
    if (source.id === target.id) return 'A column cannot relate to itself.';
    if (!target.isPrimaryKey && !target.isUnique) return 'The target must be a Primary Key or Unique column.';
    if (!this.compatibleTypes(source.sqlType, target.sqlType)) return 'Source and target PostgreSQL types must match.';
    if (!['many-to-one', 'one-to-one'].includes(draft.cardinality)) return 'Select a supported cardinality.';
    if (!['no-action', 'cascade', 'set-null'].includes(draft.onDelete)) return 'Select a supported On Delete action.';
    if (!allowExisting && this.design().relationships.some((item) => item.fromColumnId === source.id
      && item.toColumnId === target.id && item.cardinality === draft.cardinality)) return 'This relationship already exists.';
    return '';
  }

  private toRequest(draft: RelationshipDraft): AcceptSuggestionRequest {
    return {
      fromColumnId: draft.fromColumnId!,
      toColumnId: draft.toColumnId!,
      cardinality: draft.cardinality,
      onDelete: draft.onDelete,
    };
  }

  private tableById(tableId: number | null): DesignTable | undefined {
    return this.tables().find((table) => table.id === tableId);
  }

  private columnInTable(tableId: number | null, columnId: number | null): DesignColumn | undefined {
    return this.tableById(tableId)?.columns.find((column) => column.id === columnId);
  }

  private compatibleTypes(left: string, right: string): boolean {
    const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toUpperCase()
      .replace('TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ');
    return normalize(left) === normalize(right);
  }

  private showError(error: unknown, fallback: string): void {
    const body = (error as { error?: ApiErrorBody & { detail?: string } } | null)?.error;
    this.feedback.set({ kind: 'error', title: fallback, message: body?.detail || body?.message || 'Try again after refreshing the schema.' });
  }
}
