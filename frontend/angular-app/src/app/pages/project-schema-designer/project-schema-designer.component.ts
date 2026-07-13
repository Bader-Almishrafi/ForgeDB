import { DatePipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft, LucideCheckCircle2, LucideClipboard, LucideDatabase,
  LucideFileCheck2, LucidePencil, LucideRefreshCw, LucideSave, LucideTable2,
  LucideTriangleAlert,
} from '@lucide/angular';
import { Observable, Subject, finalize, forkJoin, take } from 'rxjs';
import { DesignColumn, DesignModelResponse, DesignTable, ProjectCleaningSummary, ValidationIssue } from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { UnsavedChangesAware } from '../../services/unsaved-changes.guard';
import { WorkflowStateService } from '../../services/workflow-state.service';

type SchemaTab = 'tables' | 'sql' | 'constraints';
type FeedbackKind = 'success' | 'warning' | 'error';

interface Feedback { kind: FeedbackKind; title: string; message: string; }
interface ColumnDraft {
  name: string;
  sqlType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  defaultValue: string | null;
  isAutoIncrement: boolean;
}
interface DraftErrors { tables: Record<number, string>; columns: Record<number, Record<string, string>>; }

const reservedWords = new Set([
  'all','analyse','analyze','and','any','array','as','asc','asymmetric','both','case','cast','check',
  'collate','column','constraint','create','current_date','current_role','current_time','current_timestamp',
  'current_user','default','deferrable','desc','distinct','do','else','end','except','false','fetch','for',
  'foreign','from','grant','group','having','in','initially','intersect','into','lateral','leading','limit',
  'localtime','localtimestamp','not','null','offset','on','only','or','order','placing','primary','references',
  'returning','select','session_user','some','symmetric','table','then','to','trailing','true','union','unique',
  'user','using','variadic','when','where','window','with',
]);
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
// Base types selectable in the Data Type dropdown. VARCHAR is parameterized separately (see
// baseDataType/varcharLength/updateVarcharLength) — the persisted sqlType is always the fully
// composed string (e.g. "VARCHAR(255)"), matching backend SchemaColumnRules.TryNormalizeSqlType
// exactly, so no backend DTO change was needed to support arbitrary VARCHAR lengths.
const baseDataTypes = [
  'SMALLINT', 'INTEGER', 'BIGINT', 'NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE PRECISION',
  'BOOLEAN', 'VARCHAR', 'TEXT', 'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'UUID',
] as const;
const DEFAULT_VARCHAR_LENGTH = 255;
const MAX_VARCHAR_LENGTH = 10_485_760; // matches backend SchemaColumnRules.MaxVarcharLength
const VARCHAR_PATTERN = /^VARCHAR\((\d+)\)$/i;

@Component({
  selector: 'app-project-schema-designer',
  standalone: true,
  imports: [
    DatePipe, FormsModule, NgClass, RouterLink, LucideArrowLeft, LucideCheckCircle2,
    LucideClipboard, LucideDatabase, LucideFileCheck2, LucidePencil,
    LucideRefreshCw, LucideSave, LucideTable2, LucideTriangleAlert,
  ],
  templateUrl: './project-schema-designer.component.html',
  styleUrl: './project-schema-designer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectSchemaDesignerComponent implements OnInit, UnsavedChangesAware {
  readonly Math = Math;
  private readonly schemaApi = inject(DesignApiService);
  private readonly api = inject(ForgeApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly workflow = inject(WorkflowStateService);
  private allowNavigation = false;
  private leaveDecision: Subject<boolean> | null = null;

  readonly stayButton = viewChild<ElementRef<HTMLButtonElement>>('stayButton');
  readonly design = signal<DesignModelResponse | null>(null);
  readonly cleaning = signal<ProjectCleaningSummary | null>(null);
  readonly projectName = signal('');
  readonly loading = signal(true);
  readonly generating = signal(false);
  readonly saving = signal(false);
  readonly validating = signal(false);
  readonly sqlLoading = signal(false);
  readonly selectedTableId = signal<number | null>(null);
  readonly activeTab = signal<SchemaTab>('tables');
  readonly tableNames = signal<Record<number, string>>({});
  readonly columnDrafts = signal<Record<number, ColumnDraft>>({});
  readonly feedback = signal<Feedback | null>(null);
  readonly copied = signal(false);
  readonly leaveDialogOpen = signal(false);
  readonly showAllIssues = signal(false);
  readonly conflict = signal(false);
  projectId = 0;
  readonly dataTypeOptions = baseDataTypes;
  readonly maxVarcharLength = MAX_VARCHAR_LENGTH;

  readonly draftTables = computed(() => (this.design()?.tables ?? []).map(table => ({
    ...table,
    name: this.tableNames()[table.id] ?? table.name,
    columns: table.columns.map(column => ({ ...column, ...(this.columnDrafts()[column.id] ?? {}) })),
  })));
  readonly selectedTable = computed(() => this.draftTables().find(table => table.id === this.selectedTableId()) ?? null);
  readonly tableCount = computed(() => this.draftTables().length);
  readonly columnCount = computed(() => this.draftTables().reduce((total, table) => total + table.columns.length, 0));
  readonly draftErrors = computed<DraftErrors>(() => this.validateDraft(this.draftTables()));
  readonly hasDraftErrors = computed(() => Object.keys(this.draftErrors().tables).length > 0
    || Object.values(this.draftErrors().columns).some(fields => Object.keys(fields).length > 0));
  readonly hasNameErrors = this.hasDraftErrors;
  readonly dirty = computed(() => {
    const design = this.design();
    if (!design) return false;
    return design.tables.some(table => (this.tableNames()[table.id] ?? table.name) !== table.name)
      || design.tables.some(table => table.columns.some(column => {
        const draft = this.columnDrafts()[column.id];
        return Boolean(draft) && (draft.name !== column.name
          || draft.sqlType !== column.sqlType
          || draft.isNullable !== column.isNullable
          || draft.isPrimaryKey !== column.isPrimaryKey
          || draft.isUnique !== column.isUnique
          || (draft.defaultValue || null) !== (column.defaultValue || null)
          || draft.isAutoIncrement !== Boolean(column.isAutoIncrement));
      }));
  });
  readonly blockingIssues = computed(() => (this.design()?.validationIssues ?? []).filter(issue => issue.severity === 'error'));
  readonly warningIssues = computed(() => (this.design()?.validationIssues ?? []).filter(issue => issue.severity !== 'error'));
  readonly visibleIssues = computed(() => this.showAllIssues()
    ? this.design()?.validationIssues ?? []
    : [...this.blockingIssues(), ...this.warningIssues().slice(0, 4)]);
  readonly hiddenIssueCount = computed(() => Math.max(0, (this.design()?.validationIssues.length ?? 0) - this.visibleIssues().length));
  readonly canContinue = computed(() => Boolean(this.design()?.canContinue) && !this.dirty() && !this.hasDraftErrors());
  readonly liveSql = computed(() => this.generateSql(this.draftTables(), this.design()?.relationships ?? []));
  readonly relationshipSummary = computed(() => {
    const design = this.design();
    if (!design?.relationships.length) return 'No persisted relationships. Relationships will be defined in the next step.';
    return design.relationships.map(item => `${this.tableName(item.fromTableId)}.${this.columnName(item.fromColumnId)} references ${this.tableName(item.toTableId)}.${this.columnName(item.toColumnId)}`).join('. ');
  });

  ngOnInit(): void {
    this.projectId = Number(this.route.snapshot.paramMap.get('projectId'));
    if (!Number.isFinite(this.projectId) || this.projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }
    this.workflow.setProjectId(this.projectId);
    this.loadWorkspace();
  }

  loadWorkspace(): void {
    this.loading.set(true);
    this.feedback.set(null);
    forkJoin({
      project: this.api.getProject(this.projectId),
      cleaning: this.api.getProjectCleaningSummary(this.projectId),
      schema: this.schemaApi.getSchema(this.projectId),
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: ({ project, cleaning, schema }) => {
        this.projectName.set(project.name);
        this.cleaning.set(cleaning);
        this.applyDesign(schema);
      },
      error: error => this.feedback.set({ kind: 'error', title: 'Schema unavailable', message: this.errorMessage(error, 'Unable to load the Schema workspace.') }),
    });
  }

  generateSchema(): void {
    const current = this.design();
    if (this.dirty()) {
      this.feedback.set({ kind: 'warning', title: 'Save or discard edits first', message: 'Schema generation cannot replace a draft with unsaved names.' });
      return;
    }
    if (current && !window.confirm('Regenerate this schema from the currently confirmed cleaned dataset versions? Persisted relationships will need to be reviewed again.')) return;
    this.generating.set(true);
    this.feedback.set(null);
    this.schemaApi.generateSchema(this.projectId, current?.revision)
      .pipe(finalize(() => this.generating.set(false)))
      .subscribe({
        next: design => {
          this.applyDesign(design);
          this.feedback.set({ kind: 'success', title: 'Schema generated', message: `${design.tables.length} confirmed dataset${design.tables.length === 1 ? '' : 's'} generated as database tables.` });
        },
        error: error => this.handleMutationError(error, 'Generation failed', 'Schema could not be generated.'),
      });
  }

  saveDraft(): void {
    const design = this.design();
    if (!design || !this.dirty() || this.saving()) return;
    if (this.hasDraftErrors()) {
      this.feedback.set({ kind: 'error', title: 'Fix schema errors', message: 'Correct the highlighted names, types, constraints, and defaults before saving.' });
      return;
    }
    this.saving.set(true);
    this.feedback.set(null);
    this.schemaApi.saveSchemaDraft(this.projectId, design.revision, {
      tables: this.draftTables().map(table => ({ id: table.id, name: table.name.trim() })),
      columns: this.draftTables().flatMap(table => table.columns.map(column => ({
        id: column.id,
        name: column.name.trim(),
        dataType: column.sqlType,
        isNullable: column.isNullable,
        isPrimaryKey: column.isPrimaryKey,
        isUnique: column.isPrimaryKey ? false : column.isUnique,
        defaultValue: column.defaultValue?.trim() || null,
        isAutoIncrement: Boolean(column.isAutoIncrement),
      }))),
    }).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: saved => {
        this.applyDesign(saved);
        this.feedback.set({ kind: 'success', title: 'Draft saved', message: 'Names, types, constraints, defaults, and identity settings were persisted.' });
      },
      error: error => this.handleMutationError(error, 'Save failed', 'The schema draft could not be saved.'),
    });
  }

  validateSchema(): void {
    const design = this.design();
    if (!design || this.validating()) return;
    if (this.dirty()) {
      this.feedback.set({ kind: 'warning', title: 'Save Draft first', message: 'Validation runs against persisted schema metadata. Save the current name edits first.' });
      return;
    }
    this.validating.set(true);
    this.feedback.set(null);
    this.schemaApi.validateSchema(this.projectId, design.revision)
      .pipe(finalize(() => this.validating.set(false)))
      .subscribe({
        next: validated => {
          this.applyDesign(validated, false);
          const errors = validated.validationIssues.filter(issue => issue.severity === 'error').length;
          const warnings = validated.validationIssues.length - errors;
          this.feedback.set(errors
            ? { kind: 'error', title: 'Schema is invalid', message: `${errors} blocking error${errors === 1 ? '' : 's'} and ${warnings} warning${warnings === 1 ? '' : 's'} found.` }
            : { kind: 'success', title: 'Schema validated', message: `${warnings} non-blocking warning${warnings === 1 ? '' : 's'} found. You can continue to Relationships.` });
        },
        error: error => this.handleMutationError(error, 'Validation failed', 'Schema validation could not be completed.'),
      });
  }

  /// Reloads the persisted schema from the server, discarding any local unsaved edits, and
  /// clears the conflict state so Save/Generate/Validate can be retried against a fresh revision.
  reloadAfterConflict(): void {
    this.conflict.set(false);
    this.loadWorkspace();
  }

  private handleMutationError(error: unknown, title: string, fallback: string): void {
    if (this.isConflict(error)) {
      this.conflict.set(true);
      this.feedback.set({
        kind: 'error',
        title: 'Schema changed elsewhere',
        message: 'This schema was updated by another session since you loaded it. Reload the latest version, then reapply any edits.',
      });
      return;
    }
    this.feedback.set({ kind: 'error', title, message: this.errorMessage(error, fallback) });
  }

  refreshBackendSql(): void {
    if (!this.design() || this.dirty()) return;
    this.sqlLoading.set(true);
    this.schemaApi.getSchemaSql(this.projectId).pipe(finalize(() => this.sqlLoading.set(false))).subscribe({
      next: preview => {
        if (preview.sql !== this.liveSql()) {
          this.feedback.set({ kind: 'error', title: 'SQL preview mismatch', message: 'The local preview differs from the backend source of truth. Reload the schema before continuing.' });
        } else {
          this.feedback.set({ kind: 'success', title: 'SQL verified', message: 'The live preview matches the backend PostgreSQL generator.' });
        }
      },
      error: error => this.feedback.set({ kind: 'error', title: 'SQL unavailable', message: this.errorMessage(error, 'Backend SQL preview could not be loaded.') }),
    });
  }

  updateTableName(tableId: number, value: string): void { this.tableNames.update(current => ({ ...current, [tableId]: value })); }
  updateColumnName(columnId: number, value: string): void { this.patchColumn(columnId, { name: value }); }
  /** Bound to the Data Type <select>. `baseType` is one of dataTypeOptions (e.g. "VARCHAR", not "VARCHAR(255)"). */
  updateColumnDataType(columnId: number, baseType: string): void {
    const draft = this.columnDrafts()[columnId];
    if (!draft) return;
    const nextSqlType = baseType === 'VARCHAR'
      ? `VARCHAR(${this.varcharLength(draft.sqlType) ?? DEFAULT_VARCHAR_LENGTH})`
      : baseType;
    const wasIdentity = draft.isAutoIncrement;
    const compatible = this.isIdentityCompatible(nextSqlType);
    this.patchColumn(columnId, { sqlType: nextSqlType, ...(wasIdentity && !compatible ? { isAutoIncrement: false } : {}) });
    if (wasIdentity && !compatible) {
      this.feedback.set({ kind: 'warning', title: 'Auto Increment disabled', message: 'The selected type does not support PostgreSQL identity columns.' });
    }
  }
  /** Bound to the VARCHAR length <input>, shown only while baseDataType(sqlType) === 'VARCHAR'. */
  updateVarcharLength(columnId: number, rawLength: string | number): void {
    const draft = this.columnDrafts()[columnId];
    if (!draft || !this.isVarchar(draft.sqlType)) return;
    this.patchColumn(columnId, { sqlType: `VARCHAR(${String(rawLength).trim()})` });
  }
  updateNullable(columnId: number, value: boolean): void {
    const column = this.columnDrafts()[columnId];
    if (!column || column.isPrimaryKey || column.isAutoIncrement) return;
    this.patchColumn(columnId, { isNullable: value });
  }
  updatePrimaryKey(columnId: number, value: boolean): void {
    this.patchColumn(columnId, value
      ? { isPrimaryKey: true, isNullable: false, isUnique: false }
      : { isPrimaryKey: false });
  }
  updateUnique(columnId: number, value: boolean): void {
    if (this.columnDrafts()[columnId]?.isPrimaryKey) return;
    this.patchColumn(columnId, { isUnique: value });
  }
  updateDefaultValue(columnId: number, value: string): void { this.patchColumn(columnId, { defaultValue: value }); }
  updateAutoIncrement(columnId: number, value: boolean): void {
    const column = this.columnDrafts()[columnId];
    if (!column) return;
    if (value && !this.isIdentityCompatible(column.sqlType)) {
      this.feedback.set({ kind: 'warning', title: 'Auto Increment unavailable', message: 'PostgreSQL identity is supported only for SMALLINT, INTEGER, and BIGINT.' });
      return;
    }
    if (value && column.defaultValue?.trim()) {
      this.feedback.set({ kind: 'warning', title: 'Remove the default first', message: 'An identity column cannot also define a default value.' });
      return;
    }
    this.patchColumn(columnId, value ? { isAutoIncrement: true, isNullable: false } : { isAutoIncrement: false });
  }
  selectTable(tableId: number): void { this.selectedTableId.set(tableId); }
  tableError(tableId: number): string { return this.draftErrors().tables[tableId] ?? ''; }
  columnError(columnId: number, field = 'name'): string { return this.draftErrors().columns[columnId]?.[field] ?? ''; }
  isIdentityCompatible(sqlType: string): boolean { return ['SMALLINT', 'INTEGER', 'BIGINT'].includes(sqlType.trim().toUpperCase()); }
  isVarchar(sqlType: string): boolean { return VARCHAR_PATTERN.test(sqlType.trim()); }
  baseDataType(sqlType: string): string { return this.isVarchar(sqlType) ? 'VARCHAR' : sqlType.trim().toUpperCase(); }
  varcharLength(sqlType: string): number | null {
    const match = VARCHAR_PATTERN.exec(sqlType.trim());
    return match ? Number(match[1]) : null;
  }
  tableName(tableId: number): string { return this.draftTables().find(table => table.id === tableId)?.name ?? 'Unknown table'; }
  columnName(columnId: number): string { return this.draftTables().flatMap(table => table.columns).find(column => column.id === columnId)?.name ?? 'unknown_column'; }
  issueLocation(issue: ValidationIssue): string {
    const table = issue.tableId ? this.tableName(issue.tableId) : 'Schema';
    const column = issue.columnId ? ` / ${this.columnName(issue.columnId)}` : '';
    return `${table}${column}`;
  }
  focusIssue(issue: ValidationIssue): void { if (issue.tableId) { this.selectedTableId.set(issue.tableId); this.activeTab.set('tables'); } }
  erNodeY(tableId: number): number { const index = this.draftTables().findIndex(table => table.id === tableId); return 42 + Math.max(index, 0) * 116; }

  setTab(tab: SchemaTab): void { this.activeTab.set(tab); }
  onTabKeydown(event: KeyboardEvent, tab: SchemaTab): void {
    const tabs: SchemaTab[] = ['tables', 'sql', 'constraints'];
    const index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') { event.preventDefault(); this.activeTab.set(tabs[(index + 1) % tabs.length]); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); this.activeTab.set(tabs[(index + tabs.length - 1) % tabs.length]); }
  }

  copySql(): void {
    navigator.clipboard.writeText(this.liveSql()).then(() => {
      this.copied.set(true);
      window.setTimeout(() => this.copied.set(false), 1800);
    }).catch(() => this.feedback.set({ kind: 'error', title: 'Copy failed', message: 'Clipboard permission was denied by the browser.' }));
  }

  continueToRelationships(): void {
    const design = this.design();
    if (!design || !this.canContinue()) return;
    this.allowNavigation = true;
    void this.router.navigate(['/projects', this.projectId, 'relationships'], { queryParams: { schemaId: design.id, returnTo: 'schema' } });
  }

  canDeactivate(): boolean | Observable<boolean> {
    if (this.allowNavigation || !this.dirty()) return true;
    if (this.leaveDecision) return this.leaveDecision.asObservable().pipe(take(1));
    this.leaveDecision = new Subject<boolean>();
    this.leaveDialogOpen.set(true);
    queueMicrotask(() => this.stayButton()?.nativeElement.focus());
    return this.leaveDecision.asObservable().pipe(take(1));
  }

  resolveLeaveDialog(leave: boolean): void {
    const decision = this.leaveDecision;
    if (!decision) return;
    if (leave) this.allowNavigation = true;
    this.leaveDialogOpen.set(false);
    this.leaveDecision = null;
    decision.next(leave);
    decision.complete();
  }

  @HostListener('window:beforeunload', ['$event'])
  protectBrowserUnload(event: BeforeUnloadEvent): void { if (!this.allowNavigation && this.dirty()) { event.preventDefault(); event.returnValue = ''; } }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void { if (this.leaveDialogOpen()) this.resolveLeaveDialog(false); }

  private applyDesign(design: DesignModelResponse | null, resetNames = true): void {
    this.conflict.set(false);
    this.design.set(design);
    if (resetNames) {
      this.tableNames.set(Object.fromEntries((design?.tables ?? []).map(table => [table.id, table.name])));
      this.columnDrafts.set(Object.fromEntries((design?.tables ?? []).flatMap(table => table.columns.map(column => [column.id, {
        name: column.name,
        sqlType: column.sqlType,
        isNullable: column.isNullable,
        isPrimaryKey: column.isPrimaryKey,
        isUnique: column.isPrimaryKey ? false : column.isUnique,
        defaultValue: column.defaultValue ?? null,
        isAutoIncrement: Boolean(column.isAutoIncrement),
      }]))));
    }
    const ids = design?.tables.map(table => table.id) ?? [];
    if (!this.selectedTableId() || !ids.includes(this.selectedTableId()!)) this.selectedTableId.set(ids[0] ?? null);
  }

  private validateDraft(tables: DesignTable[]): DraftErrors {
    const errors: DraftErrors = { tables: {}, columns: {} };
    const validate = (name: string): string => {
      const trimmed = name.trim();
      if (!trimmed) return 'Name is required.';
      if (trimmed.length > 63) return 'PostgreSQL identifiers are limited to 63 characters.';
      if (!identifierPattern.test(trimmed)) return 'Use letters, digits, and underscores; start with a letter or underscore.';
      if (reservedWords.has(trimmed.toLowerCase())) return 'PostgreSQL reserved keywords are not allowed.';
      return '';
    };
    for (const table of tables) {
      const ownError = validate(table.name);
      if (ownError) errors.tables[table.id] = ownError;
      for (const column of table.columns) {
        const fields: Record<string, string> = {};
        const columnError = validate(column.name);
        if (columnError) fields['name'] = columnError;
        if (!this.isSupportedType(column.sqlType)) {
          fields['dataType'] = this.isVarchar(column.sqlType) || /^VARCHAR\(/i.test(column.sqlType.trim())
            ? `Enter a VARCHAR length between 1 and ${MAX_VARCHAR_LENGTH.toLocaleString()}.`
            : 'Select a supported PostgreSQL type.';
        }
        if (column.isPrimaryKey && column.isNullable) fields['nullable'] = 'Primary Keys are always NOT NULL.';
        if (column.isAutoIncrement && !this.isIdentityCompatible(column.sqlType)) fields['autoIncrement'] = 'Identity requires SMALLINT, INTEGER, or BIGINT.';
        if (column.isAutoIncrement && column.isNullable) fields['nullable'] = 'Identity columns must be NOT NULL.';
        if (column.isAutoIncrement && column.defaultValue?.trim()) fields['defaultValue'] = 'Identity columns cannot also define a default.';
        const defaultError = this.defaultError(column.defaultValue, column.sqlType);
        if (!fields['defaultValue'] && defaultError) fields['defaultValue'] = defaultError;
        if (Object.keys(fields).length) errors.columns[column.id] = fields;
      }
      const columnGroups = this.groupNames(table.columns.map(column => ({ id: column.id, name: column.name })));
      for (const group of columnGroups.filter(group => group.ids.length > 1)) for (const id of group.ids) {
        errors.columns[id] = { ...(errors.columns[id] ?? {}), name: `Duplicate column name '${group.name}'.` };
      }
    }
    const tableGroups = this.groupNames(tables.map(table => ({ id: table.id, name: table.name })));
    for (const group of tableGroups.filter(group => group.ids.length > 1)) for (const id of group.ids) errors.tables[id] = `Duplicate table name '${group.name}'.`;
    return errors;
  }

  private groupNames(items: Array<{ id: number; name: string }>): Array<{ name: string; ids: number[] }> {
    const groups = new Map<string, { name: string; ids: number[] }>();
    for (const item of items) {
      const key = item.name.trim().toLowerCase();
      const group = groups.get(key) ?? { name: item.name.trim(), ids: [] };
      group.ids.push(item.id); groups.set(key, group);
    }
    return [...groups.values()];
  }

  private patchColumn(columnId: number, patch: Partial<ColumnDraft>): void {
    this.columnDrafts.update(current => {
      const existing = current[columnId];
      return existing ? { ...current, [columnId]: { ...existing, ...patch } } : current;
    });
  }

  private isSupportedType(value: string): boolean {
    const trimmed = value.trim().toUpperCase();
    if (trimmed !== 'VARCHAR' && (baseDataTypes as readonly string[]).includes(trimmed)) return true;
    const varchar = VARCHAR_PATTERN.exec(value.trim());
    return Boolean(varchar && Number(varchar[1]) >= 1 && Number(varchar[1]) <= MAX_VARCHAR_LENGTH);
  }

  private defaultError(value: string | null | undefined, sqlType: string): string {
    const expression = value?.trim() ?? '';
    if (!expression) return '';
    if (expression.length > 512 || /;|--|\/\*|\*\/|[\r\n]/.test(expression)) return 'Statements, comments, and line breaks are not allowed.';
    const type = sqlType.toUpperCase();
    if (['SMALLINT', 'INTEGER', 'BIGINT'].includes(type)) {
      if (!/^[+-]?\d+$/.test(expression)) return 'Use an integer literal.';
      try {
        const number = BigInt(expression);
        if (type === 'SMALLINT' && (number < -32768n || number > 32767n)) return 'Use a value within the SMALLINT range.';
        if (type === 'INTEGER' && (number < -2147483648n || number > 2147483647n)) return 'Use a value within the INTEGER range.';
        if (type === 'BIGINT' && (number < -9223372036854775808n || number > 9223372036854775807n)) return 'Use a value within the BIGINT range.';
      } catch { return 'Use an integer literal.'; }
      return '';
    }
    if (['NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE PRECISION'].includes(type)) return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(expression) ? '' : 'Use a numeric literal.';
    if (type === 'BOOLEAN') return /^(true|false)$/i.test(expression) ? '' : 'Use true or false.';
    if (type === 'TEXT' || /^VARCHAR\(\d+\)$/.test(type)) return /^'(?:[^']|'')*'$/.test(expression) ? '' : 'Use a single-quoted text literal.';
    if (type === 'DATE') {
      const match = /^'(\d{4})-(\d{2})-(\d{2})'$/.exec(expression);
      if (!match) return "Use a quoted ISO date such as '2026-07-12'.";
      const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
      return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === `${match[1]}-${match[2]}-${match[3]}` ? '' : 'Use a real calendar date.';
    }
    if (['TIMESTAMP', 'TIMESTAMPTZ'].includes(type)) {
      if (expression.toUpperCase() === 'CURRENT_TIMESTAMP') return '';
      const timestamp = /^'(.+)'$/.exec(expression)?.[1];
      return timestamp && !Number.isNaN(Date.parse(timestamp)) ? '' : 'Use CURRENT_TIMESTAMP or a quoted ISO timestamp.';
    }
    if (type === 'UUID') return /^'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'$/i.test(expression) ? '' : 'Use a quoted UUID literal.';
    return 'Defaults are unavailable for this type.';
  }

  private generateSql(tables: DesignTable[], relationships: DesignModelResponse['relationships']): string {
    const lines = ['BEGIN;', ''];
    const { ordered, hasCycle } = this.orderTables(tables, relationships);
    for (const table of ordered) {
      const definitions = table.columns.map(column => {
        const identity = column.isAutoIncrement ? ' GENERATED BY DEFAULT AS IDENTITY' : '';
        const defaultValue = !column.isAutoIncrement && column.defaultValue?.trim() ? ` DEFAULT ${column.defaultValue.trim()}` : '';
        const nullability = column.isNullable ? '' : ' NOT NULL';
        const unique = column.isUnique && !column.isPrimaryKey ? ' UNIQUE' : '';
        return `    ${this.quote(column.name)} ${column.sqlType}${identity}${defaultValue}${nullability}${unique}`;
      });
      const primary = table.columns.filter(column => column.isPrimaryKey);
      if (primary.length) definitions.push(`    PRIMARY KEY (${primary.map(column => this.quote(column.name)).join(', ')})`);
      for (const relationship of hasCycle ? [] : relationships.filter(item => item.fromTableId === table.id)) {
        definitions.push(`    FOREIGN KEY (${this.quote(this.columnName(relationship.fromColumnId))}) REFERENCES ${this.quote(this.tableName(relationship.toTableId))} (${this.quote(this.columnName(relationship.toColumnId))}) ON DELETE ${this.onDeleteSql(relationship.onDelete)}`);
      }
      lines.push(`CREATE TABLE ${this.quote(table.name)} (`, definitions.join(',\n'), ');', '');
    }

    if (hasCycle && relationships.length) {
      const usedConstraints = new Set<string>();
      for (const relationship of relationships) {
        const fromTable = this.tableName(relationship.fromTableId);
        const fromColumn = this.columnName(relationship.fromColumnId);
        const name = this.makeUnique(`fk_${fromTable}_${fromColumn}`, usedConstraints);
        lines.push(`ALTER TABLE ${this.quote(fromTable)} ADD CONSTRAINT ${this.quote(name)} FOREIGN KEY (${this.quote(fromColumn)}) REFERENCES ${this.quote(this.tableName(relationship.toTableId))} (${this.quote(this.columnName(relationship.toColumnId))}) ON DELETE ${this.onDeleteSql(relationship.onDelete)};`);
      }
      lines.push('');
    }

    if (relationships.length) {
      const usedIndexes = new Set<string>();
      for (const relationship of relationships) {
        const table = this.tableName(relationship.fromTableId);
        const column = this.columnName(relationship.fromColumnId);
        const name = this.makeUnique(`ix_${table}_${column}`, usedIndexes);
        lines.push(`CREATE INDEX ${this.quote(name)} ON ${this.quote(table)} (${this.quote(column)});`);
      }
      lines.push('');
    }
    lines.push('COMMIT;');
    return `${lines.join('\n').trimEnd()}\n`;
  }

  private orderTables(tables: DesignTable[], relationships: DesignModelResponse['relationships']): { ordered: DesignTable[]; hasCycle: boolean } {
    const byId = new Map(tables.map(table => [table.id, table]));
    const dependencies = new Map<number, number[]>();
    for (const relationship of relationships) {
      if (relationship.fromTableId === relationship.toTableId) continue;
      const current = dependencies.get(relationship.fromTableId) ?? [];
      if (!current.includes(relationship.toTableId)) current.push(relationship.toTableId);
      dependencies.set(relationship.fromTableId, current);
    }
    const state = new Map<number, number>();
    const ordered: DesignTable[] = [];
    let hasCycle = false;
    const visit = (tableId: number): void => {
      if (hasCycle || !byId.has(tableId)) return;
      if (state.get(tableId) === 1) { hasCycle = true; return; }
      if (state.get(tableId) === 2) return;
      state.set(tableId, 1);
      for (const dependency of dependencies.get(tableId) ?? []) visit(dependency);
      state.set(tableId, 2);
      ordered.push(byId.get(tableId)!);
    };
    for (const table of [...tables].sort((left, right) => left.id - right.id)) visit(table.id);
    return { ordered: hasCycle ? [...tables].sort((left, right) => left.id - right.id) : ordered, hasCycle };
  }

  private makeUnique(baseName: string, used: Set<string>): string {
    const normalized = baseName.toLowerCase();
    let candidate = normalized;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${normalized}_${suffix++}`;
    used.add(candidate);
    return candidate;
  }

  private quote(identifier: string): string { return /^[a-z_][a-z0-9_]{0,62}$/.test(identifier) && !reservedWords.has(identifier) ? identifier : `"${identifier.replaceAll('"', '""')}"`; }
  private onDeleteSql(value: string): string { return value === 'cascade' ? 'CASCADE' : value === 'set-null' ? 'SET NULL' : 'NO ACTION'; }
  private isConflict(error: unknown): boolean { return error instanceof HttpErrorResponse && error.status === 409; }
  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const detail = error.error?.detail ?? error.error?.message;
      if (typeof detail === 'string' && detail.trim()) return detail;
    }
    return fallback;
  }
}
