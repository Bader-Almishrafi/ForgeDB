import { Injectable, computed, signal } from '@angular/core';
import { Observable, Subject, from, of, throwError } from 'rxjs';
import { catchError, concatMap, debounceTime, finalize, last, map, switchMap, tap } from 'rxjs/operators';
import { DesignApiService } from './design-api.service';
import {
  ApiErrorBody,
  CreateDesignColumnRequest,
  CreateDesignRelationshipRequest,
  CreateDesignTableRequest,
  DesignColumn,
  DesignModelResponse,
  DesignRelationship,
  DesignTable,
  UpdateDesignColumnRequest,
  UpdateDesignRelationshipRequest,
  UpdateDesignTableRequest,
  ValidationIssue,
} from './api.models';

const PREVIEW_DEBOUNCE_MS = 500;

/**
 * The single owner of Design Model state for the currently open project: the model snapshot
 * and its revision. Every mutation sends the service's own revision as If-Match, applies the
 * server's response as the new snapshot on success, and (debounced) refreshes the SQL/DBML
 * previews only after that success — so a preview fetch can never race ahead of the mutation
 * that motivated it. A 409 (stale revision — someone else changed the design, or a genuine
 * race between two writers caught by the backend's own concurrency token) sets `conflict()`
 * and stops accepting further mutations until `reload()` is called; it is never silently
 * retried, since that would turn a real conflict into a silent overwrite. A 428 reaching here
 * would mean this service failed to send If-Match — that is a bug in this file, not a normal
 * runtime state, so it is logged loudly and otherwise handled exactly like a 409.
 */
@Injectable({ providedIn: 'root' })
export class DesignStateService {
  private readonly designSignal = signal<DesignModelResponse | null>(null);
  private readonly previewSqlSignal = signal('');
  private readonly previewDbmlSignal = signal('');
  private readonly loadingSignal = signal(false);
  private readonly savingSignal = signal(false);
  private readonly conflictSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);

  private readonly previewTrigger$ = new Subject<void>();
  private projectId: number | null = null;

  readonly design = this.designSignal.asReadonly();
  readonly previewSql = this.previewSqlSignal.asReadonly();
  readonly previewDbml = this.previewDbmlSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly saving = this.savingSignal.asReadonly();
  readonly conflict = this.conflictSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  readonly revision = computed(() => this.designSignal()?.revision ?? null);
  readonly tables = computed(() => this.designSignal()?.tables ?? []);
  readonly relationships = computed(() => this.designSignal()?.relationships ?? []);
  readonly validationIssues = computed(() => this.designSignal()?.validationIssues ?? []);
  readonly errorIssueCount = computed(() => this.validationIssues().filter((issue) => issue.severity === 'error').length);
  readonly hasBlockingErrors = computed(() => this.errorIssueCount() > 0);

  constructor(private readonly designApi: DesignApiService) {
    this.previewTrigger$
      .pipe(
        debounceTime(PREVIEW_DEBOUNCE_MS),
        switchMap(() => {
          const current = this.designSignal();
          if (!current) {
            return of({ sql: '', dbml: '' });
          }

          return new Observable<{ sql: string; dbml: string }>((subscriber) => {
            let sql = '';
            let dbml = '';
            let pending = 2;
            const settle = () => {
              pending -= 1;
              if (pending === 0) {
                subscriber.next({ sql, dbml });
                subscriber.complete();
              }
            };

            this.designApi.getPreview(current.id, 'sql').pipe(catchError(() => of(''))).subscribe((value) => {
              sql = value;
              settle();
            });
            this.designApi.getPreview(current.id, 'dbml').pipe(catchError(() => of(''))).subscribe((value) => {
              dbml = value;
              settle();
            });
          });
        }),
      )
      .subscribe(({ sql, dbml }) => {
        this.previewSqlSignal.set(sql);
        this.previewDbmlSignal.set(dbml);
      });
  }

  // ---- load / generate / reload ----

  loadForProject(projectId: number): Observable<DesignModelResponse | null> {
    this.projectId = projectId;
    this.conflictSignal.set(false);
    this.errorSignal.set(null);
    this.loadingSignal.set(true);

    return this.designApi.getDesign(projectId).pipe(
      map((response) => {
        this.designSignal.set(response);
        this.previewTrigger$.next();
        return response;
      }),
      catchError((err: unknown) => {
        if (this.isNotFound(err)) {
          this.designSignal.set(null);
          this.previewSqlSignal.set('');
          this.previewDbmlSignal.set('');
          return of(null);
        }

        this.errorSignal.set(this.extractMessage(err));
        return throwError(() => err);
      }),
      finalize(() => this.loadingSignal.set(false)),
    );
  }

  /** Re-fetches the design from the server and clears any pending conflict. Used by the
   * "This design changed elsewhere" banner's Reload action — never called automatically. */
  reload(): Observable<DesignModelResponse | null> {
    if (this.projectId == null) {
      return of(null);
    }

    return this.loadForProject(this.projectId);
  }

  generate(mode: 'merge' | 'replace' = 'merge'): Observable<DesignModelResponse> {
    if (this.projectId == null) {
      return throwError(() => new Error('No project selected.'));
    }

    this.loadingSignal.set(true);
    this.errorSignal.set(null);

    return this.designApi.generateDesign(this.projectId, mode).pipe(
      tap((response) => {
        this.designSignal.set(response);
        this.conflictSignal.set(false);
        this.previewTrigger$.next();
      }),
      catchError((err: unknown) => {
        this.errorSignal.set(this.extractMessage(err));
        return throwError(() => err);
      }),
      finalize(() => this.loadingSignal.set(false)),
    );
  }

  dismissError(): void {
    this.errorSignal.set(null);
  }

  // ---- tables ----

  createTable(request: CreateDesignTableRequest): Observable<DesignModelResponse> {
    const current = this.designSignal();
    if (!current) {
      return throwError(() => new Error('No design loaded.'));
    }

    return this.applyMutation(null, (revision) => this.designApi.createTable(current.id, revision, request));
  }

  updateTable(tableId: number, patch: Partial<UpdateDesignTableRequest>): Observable<DesignModelResponse> {
    const table = this.findTable(tableId);
    if (!table) {
      return throwError(() => new Error('Table not found in the current design.'));
    }

    const merged: UpdateDesignTableRequest = { name: table.name, comment: table.comment ?? null, ...patch };

    return this.applyMutation(
      (design) => this.patchTable(design, tableId, merged),
      (revision) => this.designApi.updateTable(tableId, revision, merged),
    );
  }

  deleteTable(tableId: number): Observable<DesignModelResponse> {
    return this.applyMutation(null, (revision) => this.designApi.deleteTable(tableId, revision));
  }

  // ---- columns ----

  createColumn(tableId: number, request: CreateDesignColumnRequest): Observable<DesignModelResponse> {
    return this.applyMutation(null, (revision) => this.designApi.createColumn(tableId, revision, request));
  }

  updateColumn(columnId: number, patch: Partial<UpdateDesignColumnRequest>): Observable<DesignModelResponse> {
    const column = this.findColumn(columnId);
    if (!column) {
      return throwError(() => new Error('Column not found in the current design.'));
    }

    const merged: UpdateDesignColumnRequest = {
      name: column.name,
      sqlType: column.sqlType,
      isNullable: column.isNullable,
      isPrimaryKey: column.isPrimaryKey,
      isUnique: column.isUnique,
      ordinal: column.ordinal,
      ...patch,
    };

    return this.applyMutation(
      (design) => this.patchColumn(design, columnId, merged),
      (revision) => this.designApi.updateColumn(columnId, revision, merged),
    );
  }

  deleteColumn(columnId: number): Observable<DesignModelResponse> {
    return this.applyMutation(null, (revision) => this.designApi.deleteColumn(columnId, revision));
  }

  /** Single-column PK rule (v1): turns PK on for `columnId` and off for every other column of
   * the same table, as sequential PATCHes so each is its own revision-checked step. */
  setPrimaryKey(tableId: number, columnId: number): Observable<DesignModelResponse> {
    const table = this.findTable(tableId);
    if (!table) {
      return throwError(() => new Error('Table not found in the current design.'));
    }

    const target = table.columns.find((column) => column.id === columnId);
    const othersToClear = table.columns.filter((column) => column.id !== columnId && column.isPrimaryKey);

    if (target?.isPrimaryKey && othersToClear.length === 0) {
      const current = this.designSignal();
      return current ? of(current) : throwError(() => new Error('No design loaded.'));
    }

    const steps: Array<() => Observable<DesignModelResponse>> = [
      ...othersToClear.map((column) => () => this.updateColumn(column.id, { isPrimaryKey: false })),
      () => this.updateColumn(columnId, { isPrimaryKey: true }),
    ];

    return from(steps).pipe(
      concatMap((step) => step()),
      last(),
    );
  }

  /** Up/down column reordering via two sequential ordinal PATCHes on the existing column
   * endpoint — no new backend endpoint needed for single-step swaps. */
  moveColumn(tableId: number, columnId: number, direction: 'up' | 'down'): Observable<DesignModelResponse> {
    const columns = this.columnsForTable(tableId);
    const index = columns.findIndex((column) => column.id === columnId);
    const swapIndex = direction === 'up' ? index - 1 : index + 1;

    if (index < 0 || swapIndex < 0 || swapIndex >= columns.length) {
      const current = this.designSignal();
      return current ? of(current) : throwError(() => new Error('No design loaded.'));
    }

    const a = columns[index];
    const b = columns[swapIndex];

    return this.updateColumn(a.id, { ordinal: b.ordinal }).pipe(
      concatMap(() => this.updateColumn(b.id, { ordinal: a.ordinal })),
    );
  }

  // ---- relationships ----

  createRelationship(request: CreateDesignRelationshipRequest): Observable<DesignModelResponse> {
    const current = this.designSignal();
    if (!current) {
      return throwError(() => new Error('No design loaded.'));
    }

    return this.applyMutation(null, (revision) => this.designApi.createRelationship(current.id, revision, request));
  }

  updateRelationship(relationshipId: number, patch: Partial<UpdateDesignRelationshipRequest>): Observable<DesignModelResponse> {
    const relationship = this.findRelationship(relationshipId);
    if (!relationship) {
      return throwError(() => new Error('Relationship not found in the current design.'));
    }

    const merged: UpdateDesignRelationshipRequest = {
      cardinality: relationship.cardinality,
      onDelete: relationship.onDelete,
      ...patch,
    };

    return this.applyMutation(null, (revision) => this.designApi.updateRelationship(relationshipId, revision, merged));
  }

  deleteRelationship(relationshipId: number): Observable<DesignModelResponse> {
    return this.applyMutation(null, (revision) => this.designApi.deleteRelationship(relationshipId, revision));
  }

  // ---- read helpers for components ----

  columnsForTable(tableId: number): DesignColumn[] {
    return (this.findTable(tableId)?.columns ?? []).slice().sort((a, b) => a.ordinal - b.ordinal);
  }

  relationshipsForTable(tableId: number): DesignRelationship[] {
    const table = this.findTable(tableId);
    if (!table) {
      return [];
    }

    const columnIds = new Set(table.columns.map((column) => column.id));
    return this.relationships().filter((rel) => columnIds.has(rel.fromColumnId) || columnIds.has(rel.toColumnId));
  }

  /** Includes relationship-body issues (e.g. fk-type-mismatch) that don't carry a TableId on
   * the backend DTO, by cross-referencing this table's relationship ids — see PLAN.md. */
  issuesForTable(tableId: number): ValidationIssue[] {
    const relationshipIds = new Set(this.relationshipsForTable(tableId).map((rel) => rel.id));
    return this.validationIssues().filter(
      (issue) => issue.tableId === tableId || (issue.relationshipId != null && relationshipIds.has(issue.relationshipId)),
    );
  }

  issuesForColumn(columnId: number): ValidationIssue[] {
    return this.validationIssues().filter((issue) => issue.columnId === columnId);
  }

  tableBadgeSeverity(tableId: number): 'error' | 'warning' | null {
    const issues = this.issuesForTable(tableId);
    if (issues.some((issue) => issue.severity === 'error')) {
      return 'error';
    }

    if (issues.some((issue) => issue.severity === 'warning')) {
      return 'warning';
    }

    return null;
  }

  tableName(tableId: number): string {
    return this.findTable(tableId)?.name ?? '';
  }

  columnName(columnId: number): string {
    return this.findColumn(columnId)?.name ?? '';
  }

  // ---- internals ----

  private applyMutation(
    optimisticPatch: ((design: DesignModelResponse) => DesignModelResponse) | null,
    request: (revision: number) => Observable<DesignModelResponse>,
  ): Observable<DesignModelResponse> {
    if (this.conflictSignal()) {
      return throwError(() => new Error('Design has a pending conflict; reload before making further changes.'));
    }

    const current = this.designSignal();
    if (!current) {
      return throwError(() => new Error('No design loaded.'));
    }

    const previous = current;
    if (optimisticPatch) {
      this.designSignal.set(optimisticPatch(current));
    }

    this.savingSignal.set(true);
    this.errorSignal.set(null);

    return request(current.revision).pipe(
      tap((response) => {
        this.designSignal.set(response);
        this.previewTrigger$.next();
      }),
      catchError((err: unknown) => {
        if (optimisticPatch) {
          this.designSignal.set(previous);
        }

        if (this.isPreconditionRequired(err)) {
          // A mutation left this service without a valid revision to send as If-Match — a bug
          // here, not a normal runtime state. Treat it exactly like a conflict so the user still
          // gets a safe, non-destructive recovery path.
          console.error('DesignStateService sent a mutation without If-Match (428). This is a client bug.', err);
          this.conflictSignal.set(true);
        } else if (this.designApi.isRevisionConflict(err)) {
          this.conflictSignal.set(true);
        } else {
          this.errorSignal.set(this.extractMessage(err));
        }

        return throwError(() => err);
      }),
      finalize(() => this.savingSignal.set(false)),
    );
  }

  private patchTable(design: DesignModelResponse, tableId: number, patch: Partial<DesignTable>): DesignModelResponse {
    return {
      ...design,
      tables: design.tables.map((table) => (table.id === tableId ? { ...table, ...patch } : table)),
    };
  }

  private patchColumn(design: DesignModelResponse, columnId: number, patch: Partial<DesignColumn>): DesignModelResponse {
    return {
      ...design,
      tables: design.tables.map((table) => ({
        ...table,
        columns: table.columns.map((column) => (column.id === columnId ? { ...column, ...patch } : column)),
      })),
    };
  }

  private findTable(tableId: number): DesignTable | undefined {
    return this.designSignal()?.tables.find((table) => table.id === tableId);
  }

  private findColumn(columnId: number): DesignColumn | undefined {
    return this.designSignal()
      ?.tables.flatMap((table) => table.columns)
      .find((column) => column.id === columnId);
  }

  private findRelationship(relationshipId: number): DesignRelationship | undefined {
    return this.designSignal()?.relationships.find((rel) => rel.id === relationshipId);
  }

  private isNotFound(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { status?: number }).status === 404;
  }

  private isPreconditionRequired(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { status?: number }).status === 428;
  }

  private extractMessage(err: unknown): string {
    if (typeof err === 'object' && err !== null && 'error' in err) {
      const body = (err as { error?: ApiErrorBody }).error;
      if (body?.message) {
        return body.message;
      }
    }

    return 'Something went wrong. Please try again.';
  }
}
