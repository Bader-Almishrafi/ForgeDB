import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { DesignColumn, ValidationIssue } from '../../../services/api.models';
import { DesignStateService } from '../../../services/design-state.service';
import { sanitizeIdentifier } from '../../../services/identifier-sanitizer';
import { ColumnTypeSelectComponent } from '../column-type-select/column-type-select.component';
import { RelationshipsPanelComponent } from '../relationships-panel/relationships-panel.component';

/**
 * Center panel of the master-detail Schema Designer layout: editable header (name/comment) for
 * the selected table, its full column grid (name/type/nullable/PK/unique/reorder/delete), an
 * inline "add column" form, and the table's relationships panel. Every mutation goes through
 * `DesignStateService` — this component never calls the API directly. Text fields are
 * uncontrolled inputs (bound once via `[value]`, read via a template reference variable on
 * blur/Enter/Escape) so a background revision refresh can never clobber a value the user is
 * mid-typing, matching the pattern already used by the SQL-type free-text editor.
 */
@Component({
  selector: 'app-table-editor-panel',
  standalone: true,
  imports: [FormsModule, ColumnTypeSelectComponent, RelationshipsPanelComponent],
  templateUrl: './table-editor-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableEditorPanelComponent {
  readonly tableId = input.required<number>();
  /** Column to visually highlight (e.g. after "jump to issue" navigation from the Issues
   * Drawer) — set by the parent page, not owned by this component. */
  readonly highlightedColumnId = input<number | null>(null);
  readonly tableDeleted = output<number>();

  readonly table = computed(() => this.designState.tables().find((table) => table.id === this.tableId()));
  readonly columns = computed(() => this.designState.columnsForTable(this.tableId()));

  /** Table-level issues only (no columnId) — column-specific issues are rendered per row. */
  readonly tableIssues = computed(() => this.designState.issuesForTable(this.tableId()).filter((issue) => issue.columnId == null));

  /** Mirrors the Issues Drawer's own gate for the "Add id column" one-click fix (that fix applies
   * whenever the issue is present, regardless of the table's overall badge severity — a missing
   * primary key is warning-severity on its own), duplicated here so this panel works
   * independently of whether the drawer is open. */
  readonly canAddIdColumn = computed(() =>
    this.designState.issuesForTable(this.tableId()).some((issue) => issue.code === 'table-without-primary-key'),
  );

  /** Key of the field currently saving, shown as "Saving…". */
  readonly savingField = signal<string | null>(null);
  /** Key of the field that just saved, shown as "Saved" for ~900ms then cleared. */
  readonly savedField = signal<string | null>(null);

  readonly addColumnError = signal<string | null>(null);
  readonly savingAddColumn = signal(false);

  newColumnName = '';
  newColumnSqlType = 'text';
  newColumnNullable = true;

  constructor(protected readonly designState: DesignStateService) {}

  // ---- table header ----

  onTableNameEnter(input: HTMLInputElement): void {
    input.blur();
  }

  onTableNameEscape(input: HTMLInputElement): void {
    input.value = this.table()?.name ?? '';
  }

  onTableNameBlur(input: HTMLInputElement): void {
    const table = this.table();
    if (!table) {
      return;
    }

    const value = input.value.trim();
    if (!value || value === table.name) {
      input.value = table.name;
      return;
    }

    this.saveField('table-name', this.designState.updateTable(table.id, { name: value }));
  }

  onTableCommentEnter(input: HTMLInputElement): void {
    input.blur();
  }

  onTableCommentEscape(input: HTMLInputElement): void {
    input.value = this.table()?.comment ?? '';
  }

  onTableCommentBlur(input: HTMLInputElement): void {
    const table = this.table();
    if (!table) {
      return;
    }

    const value = input.value.trim();
    const current = table.comment ?? '';
    if (value === current) {
      return;
    }

    this.saveField('table-comment', this.designState.updateTable(table.id, { comment: value || null }));
  }

  addIdColumnFix(): void {
    const table = this.table();
    if (!table) {
      return;
    }

    this.saveField(
      'fix-add-id',
      this.designState.createColumn(table.id, {
        name: 'id',
        sqlType: 'bigint',
        isPrimaryKey: true,
        isNullable: false,
        isUnique: false,
        ordinal: 0,
        sourceColumnName: null,
      }),
    );
  }

  deleteTable(): void {
    const table = this.table();
    if (!table) {
      return;
    }

    const columnCount = this.designState.columnsForTable(table.id).length;
    const relationshipCount = this.designState.relationshipsForTable(table.id).length;
    const confirmed = window.confirm(
      `Delete table '${table.name}'? This removes ${columnCount} column(s) and ${relationshipCount} relationship(s).`,
    );

    if (!confirmed) {
      return;
    }

    this.designState.deleteTable(table.id).subscribe({
      next: () => this.tableDeleted.emit(table.id),
    });
  }

  // ---- column grid ----

  issuesForColumn(column: DesignColumn): ValidationIssue[] {
    return this.designState.issuesForColumn(column.id);
  }

  columnInvalidIdentifierIssue(column: DesignColumn): ValidationIssue | undefined {
    return this.issuesForColumn(column).find((issue) => issue.code === 'invalid-identifier');
  }

  columnErrorIssues(column: DesignColumn): ValidationIssue[] {
    return this.issuesForColumn(column).filter((issue) => issue.severity === 'error');
  }

  onColumnNameEnter(input: HTMLInputElement): void {
    input.blur();
  }

  onColumnNameEscape(input: HTMLInputElement, column: DesignColumn): void {
    input.value = column.name;
  }

  onColumnNameBlur(input: HTMLInputElement, column: DesignColumn): void {
    const value = input.value.trim();
    if (!value || value === column.name) {
      input.value = column.name;
      return;
    }

    this.saveField(`col-${column.id}-name`, this.designState.updateColumn(column.id, { name: value }));
  }

  renameColumnToSanitized(column: DesignColumn): void {
    const sanitized = sanitizeIdentifier(column.name);
    this.saveField(`col-${column.id}-name`, this.designState.updateColumn(column.id, { name: sanitized }));
  }

  onSqlTypeChange(column: DesignColumn, value: string): void {
    this.saveField(`col-${column.id}-sqlType`, this.designState.updateColumn(column.id, { sqlType: value }));
  }

  onNullableChange(column: DesignColumn, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.saveField(`col-${column.id}-nullable`, this.designState.updateColumn(column.id, { isNullable: checked }));
  }

  onPrimaryKeyChange(column: DesignColumn, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const key = `col-${column.id}-pk`;

    if (checked) {
      this.saveField(key, this.designState.setPrimaryKey(this.tableId(), column.id));
    } else {
      this.saveField(key, this.designState.updateColumn(column.id, { isPrimaryKey: false }));
    }
  }

  onUniqueChange(column: DesignColumn, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.saveField(`col-${column.id}-unique`, this.designState.updateColumn(column.id, { isUnique: checked }));
  }

  isFirstColumn(column: DesignColumn): boolean {
    const columns = this.columns();
    return columns.length > 0 && columns[0].id === column.id;
  }

  isLastColumn(column: DesignColumn): boolean {
    const columns = this.columns();
    return columns.length > 0 && columns[columns.length - 1].id === column.id;
  }

  moveColumnUp(column: DesignColumn): void {
    this.designState.moveColumn(this.tableId(), column.id, 'up').subscribe();
  }

  moveColumnDown(column: DesignColumn): void {
    this.designState.moveColumn(this.tableId(), column.id, 'down').subscribe();
  }

  deleteColumn(column: DesignColumn): void {
    const affected = this.designState
      .relationships()
      .filter((rel) => rel.fromColumnId === column.id || rel.toColumnId === column.id).length;

    const confirmed = window.confirm(
      `Delete column '${column.name}'? This removes it and ${affected} relationship(s) referencing it.`,
    );

    if (!confirmed) {
      return;
    }

    this.designState.deleteColumn(column.id).subscribe();
  }

  // ---- add column ----

  addColumn(): void {
    const name = this.newColumnName.trim();
    if (!name || this.savingAddColumn()) {
      return;
    }

    this.addColumnError.set(null);
    this.savingAddColumn.set(true);
    const nextOrdinal = this.columns().length;

    this.designState
      .createColumn(this.tableId(), {
        name,
        sqlType: this.newColumnSqlType,
        isNullable: this.newColumnNullable,
        isPrimaryKey: false,
        isUnique: false,
        ordinal: nextOrdinal,
        sourceColumnName: null,
      })
      .subscribe({
        next: () => {
          this.savingAddColumn.set(false);
          this.newColumnName = '';
          this.newColumnSqlType = 'text';
          this.newColumnNullable = true;
        },
        error: () => {
          this.savingAddColumn.set(false);
          this.addColumnError.set('Unable to add column. Please try again.');
        },
      });
  }

  // ---- internals ----

  private saveField(key: string, request: Observable<unknown>): void {
    this.savingField.set(key);
    this.savedField.set(null);

    request.subscribe({
      next: () => {
        this.savingField.set(null);
        this.savedField.set(key);
        window.setTimeout(() => {
          if (this.savedField() === key) {
            this.savedField.set(null);
          }
        }, 900);
      },
      error: () => {
        this.savingField.set(null);
      },
    });
  }
}
