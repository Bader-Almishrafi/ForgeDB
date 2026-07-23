import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, forkJoin, map, of, switchMap } from 'rxjs';
import {
  DatasetVersion,
  DesignModelResponse,
  DesignTable,
  ProjectWorkflow,
  ProjectWorkflowDataset,
  ValidationIssue,
} from './api.models';
import { DesignApiService } from './design-api.service';
import { ForgeApiService } from './forge-api.service';
import { ProjectWorkflowContextService } from './project-workflow-context.service';
import {
  ColumnDraft,
  baseDataType as getBaseDataType,
  buildDraftTables,
  defaultVarcharLength,
  identityCompatible,
  isVarcharType,
  schemaDraftIsDirty,
  validateSchemaDraft,
  varcharLength as getVarcharLength,
} from './schema-draft';
import { Feedback, SchemaSourceRow, SchemaWorkspace } from './project-schema-designer.models';

@Injectable()
export class ProjectSchemaDesignerService {
  private readonly schemaApi = inject(DesignApiService);
  private readonly api = inject(ForgeApiService);
  readonly workflowContext = inject(ProjectWorkflowContextService);

  projectId = 0;
  
  readonly workflow = this.workflowContext.workflow;
  readonly design = signal<DesignModelResponse | null>(null);
  readonly versions = signal<Record<number, DatasetVersion[]>>({});
  readonly loading = signal(true);
  readonly generating = signal(false);
  readonly saving = signal(false);
  readonly validating = signal(false);
  readonly sqlLoading = signal(false);
  readonly sqlPreview = signal('');
  readonly sqlRevision = signal<number | null>(null);
  readonly sqlError = signal('');
  readonly tableNames = signal<Record<number, string>>({});
  readonly columnDrafts = signal<Record<number, ColumnDraft>>({});
  readonly feedback = signal<Feedback | null>(null);
  readonly conflict = signal(false);
  readonly datasetId = signal<number | null>(null);
  readonly selectedTableId = signal<number | null>(null);

  readonly projectName = computed(() => this.workflow()?.projectName ?? '');
  readonly schemaStatus = computed(() => this.workflow()?.schemaStatus ?? this.design()?.status ?? 'None');
  readonly isStale = computed(() => this.design()?.isStale === true || this.schemaStatus() === 'Stale');
  readonly schemaBlocked = computed(() => this.workflow()?.canBuildSchema !== true);
  readonly schemaBlockingReason = computed(() => this.schemaBlocked()
    ? this.workflow()?.blockingReasons[0] ?? 'Complete the preceding workflow steps before building a schema.'
    : '');
  readonly datasetQuery = computed(() => this.datasetId() ? { datasetId: this.datasetId() } : null);

  readonly draftTables = computed(() => buildDraftTables(this.design(), this.tableNames(), this.columnDrafts()));
  readonly selectedTable = computed(() => this.draftTables().find((table) => table.id === this.selectedTableId()) ?? null);
  readonly tableCount = computed(() => this.draftTables().length);
  readonly columnCount = computed(() => this.draftTables().reduce((total, table) => total + table.columns.length, 0));
  readonly draftErrors = computed(() => validateSchemaDraft(this.draftTables()));
  readonly hasDraftErrors = computed(() => Object.keys(this.draftErrors().tables).length > 0
    || Object.values(this.draftErrors().columns).some((fields) => Object.keys(fields).length > 0));
  readonly dirty = computed(() => schemaDraftIsDirty(this.design(), this.tableNames(), this.columnDrafts()));
  readonly blockingIssues = computed(() => (this.design()?.validationIssues ?? []).filter((issue) => issue.severity === 'error'));
  readonly warningIssues = computed(() => (this.design()?.validationIssues ?? []).filter((issue) => issue.severity !== 'error'));
  
  readonly canGenerate = computed(() => !this.schemaBlocked() && !this.conflict() && !this.generating() && !this.saving() && !this.validating());
  readonly canSave = computed(() => !this.schemaBlocked() && !this.isStale() && !this.conflict() && Boolean(this.design())
    && this.dirty() && !this.hasDraftErrors() && !this.saving() && !this.validating());
  readonly canValidate = computed(() => !this.schemaBlocked() && !this.isStale() && !this.conflict() && Boolean(this.design())
    && !this.dirty() && !this.saving() && !this.validating());
  readonly canMutateRelationships = computed(() => !this.schemaBlocked() && !this.isStale() && !this.conflict()
    && Boolean(this.design()) && !this.dirty() && !this.saving() && !this.validating());
  readonly canContinue = computed(() => this.workflow()?.canExport === true && this.design()?.status === 'Valid'
    && !this.dirty() && !this.isStale() && !this.conflict());
  
  readonly continueBlockingReason = computed(() => {
    if (this.dirty()) return 'Save your schema changes before continuing.';
    if (this.isStale()) return 'Regenerate the schema from the current active dataset versions.';
    if (this.conflict()) return 'Reload the latest schema revision before continuing.';
    return this.workflow()?.blockingReasons[0] ?? 'Save and validate the schema before continuing.';
  });
  
  readonly sourceRows = computed<SchemaSourceRow[]>(() => (this.workflow()?.datasets ?? []).map((dataset) => {
    const history = this.versions()[dataset.datasetId] ?? [];
    const activeVersion = history.find((version) => version.id === dataset.activeVersionId);
    const table = this.design()?.tables.find((item) => item.sourceDatasetId === dataset.datasetId);
    const schemaVersionId = this.design()?.sourceVersions?.[dataset.datasetId]
      ?? table?.sourceDatasetVersionId
      ?? null;
    return {
      dataset,
      activeVersion,
      schemaVersion: history.find((version) => version.id === schemaVersionId),
      schemaVersionId,
      usesCurrentVersion: schemaVersionId === null || schemaVersionId === dataset.activeVersionId,
    };
  }));

  init(projectId: number, requestedDatasetId: number | null): void {
    this.projectId = projectId;
    this.datasetId.set(requestedDatasetId);
    this.loadWorkspace();
  }

  loadWorkspace(forceWorkflow = false): void {
    this.loading.set(true);
    this.feedback.set(null);
    this.fetchWorkspace(forceWorkflow).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (workspace) => this.applyWorkspace(workspace),
      error: (error) => this.feedback.set({ kind: 'error', title: 'Schema unavailable', message: this.errorMessage(error, 'Unable to load the Schema page.') }),
    });
  }

  generateSchema(): void {
    const current = this.design();
    if (!this.canGenerate()) return;
    if (current && !window.confirm('Regenerate Schema from the current confirmed active versions? Unsaved edits will be lost and existing relationships may require review.')) return;
    this.generating.set(true);
    this.feedback.set(null);
    this.schemaApi.generateSchema(this.projectId, current?.revision).pipe(
      switchMap(() => this.fetchWorkspace(true)),
      finalize(() => this.generating.set(false)),
    ).subscribe({
      next: (workspace) => {
        this.applyWorkspace(workspace);
        this.feedback.set({ kind: 'success', title: current ? 'Schema regenerated' : 'Schema generated', message: `${workspace.design?.tables.length ?? 0} active dataset version(s) are represented as tables.` });
      },
      error: (error) => this.handleMutationError(error, 'Generation failed', 'Schema could not be generated.'),
    });
  }

  saveDraft(): void {
    const design = this.design();
    if (!design || !this.canSave()) return;
    this.saving.set(true);
    this.feedback.set(null);
    this.schemaApi.saveSchemaDraft(this.projectId, design.revision, {
      tables: this.draftTables().map((table) => ({ id: table.id, name: table.name.trim() })),
      columns: this.draftTables().flatMap((table) => table.columns.map((column) => ({
        id: column.id,
        name: column.name.trim(),
        dataType: column.sqlType,
        isNullable: column.isNullable,
        isPrimaryKey: column.isPrimaryKey,
        isUnique: column.isPrimaryKey ? false : column.isUnique,
        defaultValue: column.defaultValue?.trim() || null,
        isAutoIncrement: Boolean(column.isAutoIncrement),
      }))),
    }).pipe(
      switchMap(() => this.fetchWorkspace(true)),
      finalize(() => this.saving.set(false)),
    ).subscribe({
      next: (workspace) => {
        this.applyWorkspace(workspace);
        this.feedback.set({ kind: 'success', title: 'Changes saved', message: 'The persisted schema and backend SQL preview are up to date.' });
      },
      error: (error) => this.handleMutationError(error, 'Save failed', 'The schema changes could not be saved.'),
    });
  }

  validateSchema(): void {
    const design = this.design();
    if (!design || !this.canValidate()) return;
    this.validating.set(true);
    this.feedback.set(null);
    this.schemaApi.validateSchema(this.projectId, design.revision).pipe(
      switchMap(() => this.fetchWorkspace(true)),
      finalize(() => this.validating.set(false)),
    ).subscribe({
      next: (workspace) => {
        this.applyWorkspace(workspace);
        const errors = workspace.design?.validationIssues.filter((issue) => issue.severity === 'error').length ?? 0;
        const warnings = (workspace.design?.validationIssues.length ?? 0) - errors;
        this.feedback.set(errors
          ? { kind: 'error', title: 'Schema is invalid', message: `${errors} blocking error(s) and ${warnings} warning(s) were reported.` }
          : { kind: 'success', title: 'Schema validated', message: warnings ? `${warnings} non-blocking warning(s) were reported.` : 'Export & Deploy availability was refreshed.' });
      },
      error: (error) => this.handleMutationError(error, 'Validation failed', 'Schema validation could not be completed.'),
    });
  }

  reloadAfterConflict(): void {
    if (this.dirty() && !window.confirm('Reload the latest schema? Local unsaved edits will be discarded.')) return;
    this.conflict.set(false);
    this.loadWorkspace(true);
  }

  refreshSqlPreview(): void {
    this.loadSqlPreview();
  }

  handleRelationshipChanged(design: DesignModelResponse): void {
    this.applyDesign(design);
    this.loadSqlPreview();
    this.workflowContext.load(this.projectId, true).subscribe();
  }

  handleRelationshipConflict(): void {
    this.conflict.set(true);
    this.feedback.set({ kind: 'error', title: 'Schema changed elsewhere', message: 'Reload the latest schema before changing relationships. Local unsaved edits will be discarded.' });
  }

  updateTableName(tableId: number, value: string): void {
    this.tableNames.update((current) => ({ ...current, [tableId]: value }));
  }

  updateColumnName(columnId: number, value: string): void {
    this.patchColumn(columnId, { name: value });
  }

  updateColumnDataType(columnId: number, baseType: string): void {
    const draft = this.columnDrafts()[columnId];
    if (!draft) return;
    const normalized = baseType.trim().toUpperCase();
    const sqlType = normalized === 'VARCHAR'
      ? `VARCHAR(${this.varcharLength(draft.sqlType) ?? defaultVarcharLength})`
      : normalized;
    const disableIdentity = draft.isAutoIncrement && !this.isIdentityCompatible(sqlType);
    this.patchColumn(columnId, { sqlType, ...(disableIdentity ? { isAutoIncrement: false } : {}) });
    if (disableIdentity) this.feedback.set({ kind: 'warning', title: 'Identity disabled', message: 'Identity requires SMALLINT, INTEGER, or BIGINT.' });
  }

  updateVarcharLength(columnId: number, rawLength: string | number): void {
    if (this.columnDrafts()[columnId] && this.isVarchar(this.columnDrafts()[columnId].sqlType)) {
      this.patchColumn(columnId, { sqlType: `VARCHAR(${String(rawLength).trim()})` });
    }
  }

  updateNullable(columnId: number, value: boolean): void {
    const column = this.columnDrafts()[columnId];
    if (column && !column.isPrimaryKey && !column.isAutoIncrement) this.patchColumn(columnId, { isNullable: value });
  }

  updatePrimaryKey(columnId: number, value: boolean): void {
    this.patchColumn(columnId, value
      ? { isPrimaryKey: true, isNullable: false, isUnique: false }
      : { isPrimaryKey: false });
  }

  updateUnique(columnId: number, value: boolean): void {
    if (!this.columnDrafts()[columnId]?.isPrimaryKey) this.patchColumn(columnId, { isUnique: value });
  }

  updateDefaultValue(columnId: number, value: string): void {
    this.patchColumn(columnId, { defaultValue: value });
  }

  updateAutoIncrement(columnId: number, value: boolean): void {
    const column = this.columnDrafts()[columnId];
    if (!column) return;
    if (value && !this.isIdentityCompatible(column.sqlType)) {
      this.feedback.set({ kind: 'warning', title: 'Identity unavailable', message: 'Identity requires SMALLINT, INTEGER, or BIGINT.' });
      return;
    }
    if (value && column.defaultValue?.trim()) {
      this.feedback.set({ kind: 'warning', title: 'Remove the default first', message: 'Identity columns cannot also define a default.' });
      return;
    }
    this.patchColumn(columnId, value ? { isAutoIncrement: true, isNullable: false } : { isAutoIncrement: false });
  }

  selectTable(tableId: number): void {
    this.selectedTableId.set(tableId);
  }

  tableError(tableId: number): string {
    return this.draftErrors().tables[tableId] ?? '';
  }

  tableHasValidationIssue(tableId: number): boolean {
    return this.design()?.validationIssues.some((issue) => issue.tableId === tableId) ?? false;
  }

  columnError(columnId: number, field: 'name' | 'dataType' | 'defaultValue' | 'nullable' | 'autoIncrement'): string {
    return this.draftErrors().columns[columnId]?.[field] ?? '';
  }

  isIdentityCompatible(sqlType: string): boolean {
    return identityCompatible(sqlType);
  }

  isVarchar(sqlType: string): boolean {
    return isVarcharType(sqlType);
  }

  baseDataType(sqlType: string): string {
    return getBaseDataType(sqlType);
  }

  varcharLength(sqlType: string): number | null {
    return getVarcharLength(sqlType);
  }

  tableName(tableId: number): string {
    return this.draftTables().find((table) => table.id === tableId)?.name ?? 'Unknown table';
  }

  columnName(columnId: number): string {
    return this.draftTables().flatMap((table) => table.columns).find((column) => column.id === columnId)?.name ?? 'unknown_column';
  }

  sourceDataset(table: DesignTable): ProjectWorkflowDataset | undefined {
    return this.workflow()?.datasets.find((dataset) => dataset.datasetId === table.sourceDatasetId);
  }

  versionKind(version?: DatasetVersion): string {
    if (!version) return 'Unknown';
    if (version.isRawOriginal) return 'Imported';
    return /restore|undo/i.test(version.operationSummary) ? 'Restored' : 'Cleaned';
  }

  issueLocation(issue: ValidationIssue): string {
    if (issue.relationshipId) {
      const relationship = this.design()?.relationships.find((item) => item.id === issue.relationshipId);
      if (relationship) return `${relationship.fromTableName}.${relationship.fromColumnName} → ${relationship.toTableName}.${relationship.toColumnName}`;
    }
    const table = issue.tableId ? this.tableName(issue.tableId) : 'Schema';
    return issue.columnId ? `${table} / ${this.columnName(issue.columnId)}` : table;
  }

  private fetchWorkspace(forceWorkflow: boolean): Observable<SchemaWorkspace> {
    return this.workflowContext.load(this.projectId, forceWorkflow).pipe(switchMap((workflow) => {
      if (!workflow) return of({ workflow: null, design: null, versions: {} });
      return forkJoin({
        workflow: of(workflow),
        design: this.schemaApi.getSchema(this.projectId),
        versions: this.loadVersions(workflow),
      });
    }));
  }

  private loadVersions(workflow: ProjectWorkflow): Observable<Record<number, DatasetVersion[]>> {
    const requests: Record<string, Observable<DatasetVersion[]>> = {};
    for (const dataset of workflow.datasets) {
      requests[String(dataset.datasetId)] = this.api.getDatasetVersions(this.projectId, dataset.datasetId)
        .pipe(catchError(() => of([])));
    }
    if (!Object.keys(requests).length) return of({});
    return forkJoin(requests).pipe(map((result) => Object.fromEntries(
      Object.entries(result).map(([datasetId, versions]) => [Number(datasetId), versions]),
    )));
  }

  private applyWorkspace(workspace: SchemaWorkspace): void {
    if (!workspace.workflow) {
      this.feedback.set({ kind: 'error', title: 'Workflow unavailable', message: this.workflowContext.error()?.message ?? 'Project workflow could not be loaded.' });
      this.applyDesign(null);
      return;
    }
    this.versions.set(workspace.versions);
    this.workflowContext.setDatasetFromQuery(this.datasetId());
    this.applyDesign(workspace.design);
    this.loadSqlPreview();
  }

  private applyDesign(design: DesignModelResponse | null): void {
    this.conflict.set(false);
    this.design.set(design);
    this.tableNames.set(Object.fromEntries((design?.tables ?? []).map((table) => [table.id, table.name])));
    this.columnDrafts.set(Object.fromEntries((design?.tables ?? []).flatMap((table) => table.columns.map((column) => [column.id, {
      name: column.name,
      sqlType: column.sqlType,
      isNullable: column.isNullable,
      isPrimaryKey: column.isPrimaryKey,
      isUnique: column.isPrimaryKey ? false : column.isUnique,
      defaultValue: column.defaultValue ?? null,
      isAutoIncrement: Boolean(column.isAutoIncrement),
    }]))));
    const tableIds = design?.tables.map((table) => table.id) ?? [];
    if (!this.selectedTableId() || !tableIds.includes(this.selectedTableId()!)) this.selectedTableId.set(tableIds[0] ?? null);
  }

  private loadSqlPreview(): void {
    if (!this.design()) {
      this.sqlPreview.set('');
      this.sqlRevision.set(null);
      this.sqlError.set('');
      return;
    }
    this.sqlLoading.set(true);
    this.sqlError.set('');
    this.schemaApi.getSchemaSql(this.projectId).pipe(finalize(() => this.sqlLoading.set(false))).subscribe({
      next: (preview) => {
        this.sqlPreview.set(preview.sql);
        this.sqlRevision.set(preview.revision);
      },
      error: (error) => this.sqlError.set(this.errorMessage(error, 'Backend SQL preview could not be loaded.')),
    });
  }

  private handleMutationError(error: unknown, title: string, fallback: string): void {
    if (this.isConflict(error)) {
      this.conflict.set(true);
      this.feedback.set({ kind: 'error', title: 'Schema changed elsewhere', message: 'Reload the latest schema. Local unsaved edits will be discarded.' });
      return;
    }
    this.feedback.set({ kind: 'error', title, message: this.errorMessage(error, fallback) });
  }

  private patchColumn(columnId: number, patch: Partial<ColumnDraft>): void {
    this.columnDrafts.update((current) => current[columnId]
      ? { ...current, [columnId]: { ...current[columnId], ...patch } }
      : current);
  }

  private isConflict(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 409;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const detail = error.error?.detail ?? error.error?.message;
      if (typeof detail === 'string' && detail.trim()) return detail;
    }
    return fallback;
  }
}
