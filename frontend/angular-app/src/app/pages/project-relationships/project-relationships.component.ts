import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, finalize, forkJoin, map, of, switchMap, throwError } from 'rxjs';
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
import { WorkflowStateService } from '../../services/workflow-state.service';

type FeedbackKind = 'success' | 'warning' | 'error';

interface Feedback {
  kind: FeedbackKind;
  title: string;
  message: string;
}

interface RelationshipFormDraft {
  fromTableId: number | null;
  fromColumnId: number | null;
  toTableId: number | null;
  toColumnId: number | null;
  cardinality: string;
  onDelete: string;
}

interface Workspace {
  suggestions: RelationshipSuggestion[];
  design: DesignModelResponse | null;
}

const emptyDraft = (): RelationshipFormDraft => ({
  fromTableId: null,
  fromColumnId: null,
  toTableId: null,
  toColumnId: null,
  cardinality: 'many-to-one',
  onDelete: 'no-action',
});

@Component({
  selector: 'app-project-relationships',
  standalone: true,
  imports: [FormsModule, NgClass, RouterLink],
  templateUrl: './project-relationships.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectRelationshipsComponent implements OnInit {
  readonly suggestions = signal<RelationshipSuggestion[]>([]);
  readonly design = signal<DesignModelResponse | null>(null);
  readonly loading = signal(true);
  readonly busyAction = signal<string | null>(null);
  readonly feedback = signal<Feedback | null>(null);
  readonly editingSuggestionId = signal<number | null>(null);
  readonly suggestionDraft = signal<RelationshipFormDraft | null>(null);
  readonly manualDraft = signal<RelationshipFormDraft>(emptyDraft());
  readonly editingRelationshipId = signal<number | null>(null);
  readonly relationshipDraft = signal<{ cardinality: string; onDelete: string } | null>(null);
  readonly deleteTarget = signal<DesignRelationship | null>(null);

  readonly pendingSuggestions = computed(() => this.suggestions().filter(item => item.status === 'suggested'));
  readonly acceptedSuggestionCount = computed(() => this.suggestions().filter(item => item.status === 'accepted').length);
  readonly rejectedSuggestionCount = computed(() => this.suggestions().filter(item => item.status === 'rejected').length);
  readonly tables = computed(() => this.design()?.tables ?? []);
  readonly persistedRelationships = computed(() => this.design()?.relationships ?? []);
  readonly needsValidation = computed(() => !!this.design() && this.design()?.status !== 'Valid');

  projectId = 0;

  constructor(
    private readonly designApi: DesignApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly workflow: WorkflowStateService,
  ) {}

  ngOnInit(): void {
    this.projectId = Number(this.route.snapshot.paramMap.get('projectId'));
    if (!Number.isInteger(this.projectId) || this.projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }

    this.workflow.setProjectId(this.projectId);
    this.reloadWorkspace();
  }

  reloadWorkspace(announce = false): void {
    if (this.busyAction()) return;
    this.feedback.set(null);
    this.loading.set(true);
    this.fetchWorkspace()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: workspace => {
          this.applyWorkspace(workspace);
          if (announce) {
            this.feedback.set({ kind: 'success', title: 'Relationships refreshed', message: 'The latest design revision, suggestions, and persisted relationships are displayed.' });
          }
        },
        error: error => this.showError(error, 'Relationships unavailable', 'ForgeDB could not load this project relationship workspace.'),
      });
  }

  detectRelationships(): void {
    this.runMutation(
      'detect',
      this.designApi.detectSuggestions(this.projectId),
      'Detection complete',
      'Pending suggestions were refreshed from the current project datasets.',
    );
  }

  validateDesign(): void {
    const design = this.design();
    if (!design) return;
    this.runMutation(
      'validate',
      this.designApi.validateSchema(this.projectId, design.revision),
      'Schema validated',
      'The current relationship design is valid and ready for ER Diagram and Deployment.',
    );
  }

  acceptSuggestion(suggestion: RelationshipSuggestion): void {
    const request = this.draftForSuggestion(suggestion);
    const validation = this.validateDraft(request, null, true);
    if (validation) {
      this.feedback.set({ kind: 'error', title: 'Suggestion needs editing', message: validation });
      return;
    }
    this.submitSuggestion(suggestion, request, false);
  }

  rejectSuggestion(suggestion: RelationshipSuggestion): void {
    this.runMutation(
      `reject:${suggestion.id}`,
      this.designApi.rejectSuggestion(suggestion.id),
      'Suggestion rejected',
      'It was removed from the pending queue and no persisted relationship was created.',
      () => this.closeSuggestionEditor(),
    );
  }

  startSuggestionEdit(suggestion: RelationshipSuggestion): void {
    this.feedback.set(null);
    this.editingSuggestionId.set(suggestion.id);
    this.suggestionDraft.set(this.draftForSuggestion(suggestion));
  }

  closeSuggestionEditor(): void {
    this.editingSuggestionId.set(null);
    this.suggestionDraft.set(null);
  }

  updateSuggestionDraft(patch: Partial<RelationshipFormDraft>): void {
    const current = this.suggestionDraft();
    if (!current) return;
    this.suggestionDraft.set(this.applyDraftPatch(current, patch));
    this.feedback.set(null);
  }

  acceptEditedSuggestion(suggestion: RelationshipSuggestion): void {
    const draft = this.suggestionDraft();
    if (!draft) return;
    const validation = this.validateDraft(draft, null, true);
    if (validation) {
      this.feedback.set({ kind: 'error', title: 'Edited suggestion is invalid', message: validation });
      return;
    }
    this.submitSuggestion(suggestion, draft, true);
  }

  updateManualDraft(patch: Partial<RelationshipFormDraft>): void {
    this.manualDraft.set(this.applyDraftPatch(this.manualDraft(), patch));
    this.feedback.set(null);
  }

  clearManualForm(): void {
    this.manualDraft.set(emptyDraft());
    this.feedback.set(null);
  }

  createManualRelationship(): void {
    const design = this.design();
    const draft = this.manualDraft();
    const validation = this.validateDraft(draft);
    if (!design || validation) {
      this.feedback.set({ kind: 'error', title: 'Relationship is invalid', message: validation || 'Generate a schema before creating relationships.' });
      return;
    }

    this.runMutation(
      'create',
      this.designApi.createRelationship(design.id, design.revision, this.toCreateRequest(draft)),
      'Relationship created',
      'The persisted relationship is displayed below. Revalidate the schema before deployment.',
      () => this.manualDraft.set(emptyDraft()),
    );
  }

  startRelationshipEdit(relationship: DesignRelationship): void {
    this.feedback.set(null);
    this.editingRelationshipId.set(relationship.id);
    this.relationshipDraft.set({ cardinality: relationship.cardinality, onDelete: relationship.onDelete });
  }

  cancelRelationshipEdit(): void {
    this.editingRelationshipId.set(null);
    this.relationshipDraft.set(null);
  }

  updateRelationshipDraft(patch: Partial<{ cardinality: string; onDelete: string }>): void {
    const current = this.relationshipDraft();
    if (!current) return;
    this.relationshipDraft.set({ ...current, ...patch });
    this.feedback.set(null);
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
      this.feedback.set({ kind: 'error', title: 'Duplicate relationship', message: 'Saving this edit would create an identical persisted relationship.' });
      return;
    }

    this.runMutation(
      `edit:${relationship.id}`,
      this.designApi.updateRelationship(relationship.id, design.revision, draft),
      'Relationship updated',
      'The latest cardinality and On Delete action are persisted. Revalidate before deployment.',
      () => this.cancelRelationshipEdit(),
    );
  }

  requestDelete(relationship: DesignRelationship): void {
    this.feedback.set(null);
    this.deleteTarget.set(relationship);
  }

  cancelDelete(): void {
    if (this.busyAction()?.startsWith('delete:')) return;
    this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const design = this.design();
    const relationship = this.deleteTarget();
    if (!design || !relationship) return;
    this.runMutation(
      `delete:${relationship.id}`,
      this.designApi.deleteRelationship(relationship.id, design.revision),
      'Relationship deleted',
      'It was removed from the persisted design and will no longer appear in the ER Diagram.',
      () => {
        this.deleteTarget.set(null);
        this.cancelRelationshipEdit();
      },
    );
  }

  columnsFor(tableId: number | null): DesignColumn[] {
    return this.tableById(tableId)?.columns ?? [];
  }

  targetColumnDisabled(draft: RelationshipFormDraft, column: DesignColumn): boolean {
    const source = this.columnInTable(draft.fromTableId, draft.fromColumnId);
    return (!column.isPrimaryKey && !column.isUnique)
      || column.id === source?.id
      || (!!source && !this.compatibleTypes(source.sqlType, column.sqlType));
  }

  targetColumnLabel(draft: RelationshipFormDraft, column: DesignColumn): string {
    const badges = [column.isPrimaryKey ? 'PK' : '', column.isUnique ? 'Unique' : ''].filter(Boolean).join(' + ');
    const source = this.columnInTable(draft.fromTableId, draft.fromColumnId);
    if (!badges) return `${column.name} · ${column.sqlType} · not PK/Unique`;
    if (source?.id === column.id) return `${column.name} · ${column.sqlType} · same endpoint`;
    if (source && !this.compatibleTypes(source.sqlType, column.sqlType)) return `${column.name} · ${column.sqlType} · type mismatch`;
    return `${column.name} · ${column.sqlType} · ${badges}`;
  }

  manualValidationMessage(): string {
    return this.validateDraft(this.manualDraft());
  }

  suggestionValidationMessage(): string {
    const draft = this.suggestionDraft();
    return draft ? this.validateDraft(draft, null, true) : '';
  }

  suggestionAvailabilityMessage(suggestion: RelationshipSuggestion): string {
    return this.validateDraft(this.draftForSuggestion(suggestion), null, true);
  }

  isBusy(key?: string): boolean {
    return key ? this.busyAction() === key : this.busyAction() !== null;
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

  relationshipLabel(relationship: DesignRelationship): string {
    return `${relationship.fromTableName}.${relationship.fromColumnName} → ${relationship.toTableName}.${relationship.toColumnName}`;
  }

  onDeleteLabel(value: string): string {
    return value === 'set-null' ? 'Set null' : value === 'cascade' ? 'Cascade' : 'No action';
  }

  cardinalityLabel(value: string): string {
    return value === 'one-to-one' ? 'One to one' : 'Many to one';
  }

  private submitSuggestion(suggestion: RelationshipSuggestion, draft: RelationshipFormDraft, edited: boolean): void {
    const design = this.design();
    if (!design) return;
    const request: AcceptSuggestionRequest = {
      fromColumnId: draft.fromColumnId!,
      toColumnId: draft.toColumnId!,
      cardinality: draft.cardinality,
      onDelete: draft.onDelete,
    };
    this.runMutation(
      `accept:${suggestion.id}`,
      this.designApi.acceptSuggestion(suggestion.id, design.revision, request),
      edited ? 'Edited suggestion accepted' : 'Suggestion accepted',
      'A real relationship was persisted and removed from the pending queue. Revalidate before deployment.',
      () => this.closeSuggestionEditor(),
    );
  }

  private runMutation<T>(
    key: string,
    request: Observable<T>,
    title: string,
    message: string,
    afterSuccess?: () => void,
  ): void {
    if (this.busyAction()) return;
    this.feedback.set(null);
    this.busyAction.set(key);
    request.pipe(
      switchMap(result => this.fetchWorkspace().pipe(map(workspace => ({ result, workspace })))),
      finalize(() => this.busyAction.set(null)),
    ).subscribe({
      next: ({ workspace }) => {
        this.applyWorkspace(workspace);
        afterSuccess?.();
        this.feedback.set({ kind: 'success', title, message });
      },
      error: error => this.recoverFromMutationError(error),
    });
  }

  private recoverFromMutationError(error: unknown): void {
    const message = this.errorMessage(error, 'The relationship operation could not be completed.');
    this.fetchWorkspace().subscribe({
      next: workspace => {
        this.applyWorkspace(workspace);
        this.feedback.set({ kind: 'error', title: 'Relationship operation failed', message });
      },
      error: () => this.feedback.set({ kind: 'error', title: 'Relationship operation failed', message }),
    });
  }

  private fetchWorkspace(): Observable<Workspace> {
    return forkJoin({
      suggestions: this.designApi.getSuggestions(this.projectId),
      design: this.designApi.getDesign(this.projectId).pipe(catchError(error => {
        const status = (error as { status?: number } | null)?.status;
        return status === 404 ? of(null) : throwError(() => error);
      })),
    });
  }

  private applyWorkspace(workspace: Workspace): void {
    this.suggestions.set(workspace.suggestions);
    this.design.set(workspace.design);
  }

  private draftForSuggestion(suggestion: RelationshipSuggestion): RelationshipFormDraft {
    const fromTable = this.tables().find(table => table.sourceDatasetId === suggestion.sourceDatasetId);
    const toTable = this.tables().find(table => table.sourceDatasetId === suggestion.targetDatasetId);
    const fromColumn = fromTable?.columns.find(column => this.sourceName(column) === suggestion.sourceColumnName);
    const toColumn = toTable?.columns.find(column => this.sourceName(column) === suggestion.targetColumnName);
    return {
      fromTableId: fromTable?.id ?? null,
      fromColumnId: fromColumn?.id ?? null,
      toTableId: toTable?.id ?? null,
      toColumnId: toColumn?.id ?? null,
      cardinality: 'many-to-one',
      onDelete: 'no-action',
    };
  }

  private applyDraftPatch(current: RelationshipFormDraft, patch: Partial<RelationshipFormDraft>): RelationshipFormDraft {
    const next = { ...current, ...patch };
    if ('fromTableId' in patch && patch.fromTableId !== current.fromTableId) {
      next.fromColumnId = null;
      next.toColumnId = null;
    }
    if ('fromColumnId' in patch && patch.fromColumnId !== current.fromColumnId) next.toColumnId = null;
    if ('toTableId' in patch && patch.toTableId !== current.toTableId) next.toColumnId = null;
    return next;
  }

  private validateDraft(draft: RelationshipFormDraft, excludingRelationshipId: number | null = null, allowExisting = false): string {
    const design = this.design();
    if (!design) return 'Generate a persisted schema before creating relationships.';
    if (!draft.fromTableId || !draft.fromColumnId || !draft.toTableId || !draft.toColumnId) {
      return 'Select source and target tables and columns.';
    }
    const source = this.columnInTable(draft.fromTableId, draft.fromColumnId);
    const target = this.columnInTable(draft.toTableId, draft.toColumnId);
    if (!source || !target) return 'Every selected table and column must belong to this project design.';
    if (source.id === target.id) return 'Source and target cannot be the exact same endpoint.';
    if (!target.isPrimaryKey && !target.isUnique) return 'Target must be a Primary Key or Unique column.';
    if (!this.compatibleTypes(source.sqlType, target.sqlType)) {
      return `Source and target PostgreSQL types must match (${source.sqlType} vs ${target.sqlType}).`;
    }
    if (!['many-to-one', 'one-to-one'].includes(draft.cardinality)) return 'Select a supported cardinality.';
    if (!['no-action', 'cascade', 'set-null'].includes(draft.onDelete)) return 'Select a supported On Delete action.';
    if (!allowExisting && design.relationships.some(item => item.id !== excludingRelationshipId
      && item.fromColumnId === source.id && item.toColumnId === target.id && item.cardinality === draft.cardinality)) {
      return 'This exact relationship already exists.';
    }
    return '';
  }

  private toCreateRequest(draft: RelationshipFormDraft): AcceptSuggestionRequest {
    return {
      fromColumnId: draft.fromColumnId!,
      toColumnId: draft.toColumnId!,
      cardinality: draft.cardinality,
      onDelete: draft.onDelete,
    };
  }

  private tableById(tableId: number | null): DesignTable | undefined {
    return this.tables().find(table => table.id === tableId);
  }

  private columnInTable(tableId: number | null, columnId: number | null): DesignColumn | undefined {
    return this.tableById(tableId)?.columns.find(column => column.id === columnId);
  }

  private sourceName(column: DesignColumn): string {
    return column.sourceColumnName ?? column.name;
  }

  private compatibleTypes(left: string, right: string): boolean {
    const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toUpperCase()
      .replace('TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ');
    return normalize(left) === normalize(right);
  }

  private showError(error: unknown, title: string, fallback: string): void {
    this.feedback.set({ kind: 'error', title, message: this.errorMessage(error, fallback) });
  }

  private errorMessage(error: unknown, fallback: string): string {
    const body = (error as { error?: ApiErrorBody } | null)?.error;
    return body?.message || fallback;
  }
}
