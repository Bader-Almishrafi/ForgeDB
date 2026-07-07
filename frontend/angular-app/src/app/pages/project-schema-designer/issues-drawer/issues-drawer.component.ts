import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { ValidationIssue } from '../../../services/api.models';
import { DesignStateService } from '../../../services/design-state.service';
import { sanitizeIdentifier } from '../../../services/identifier-sanitizer';

/** Payload emitted when the user picks an issue to jump to; a later integration step wires
 * this into the page's own table/column selection state. */
export interface IssueNavigationTarget {
  tableId?: number | null;
  columnId?: number | null;
  relationshipId?: number | null;
}

/**
 * Project-level validation issues panel: lists every current `ValidationIssue`, grouped by
 * severity, lets the user jump to the offending table/column, and offers one-click fixes for
 * the two issue codes that have an unambiguous automatic remedy. All state mutations go through
 * `DesignStateService` — this component never calls the API directly.
 */
@Component({
  selector: 'app-issues-drawer',
  standalone: true,
  imports: [],
  templateUrl: './issues-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssuesDrawerComponent {
  readonly open = input<boolean>(false);

  readonly closeDrawer = output<void>();
  readonly navigateToIssue = output<IssueNavigationTarget>();

  /** Key of the fix currently in flight (see `fixKey`), shown as "Saving...". */
  readonly savingKey = signal<string | null>(null);
  /** Key of the fix that just succeeded, shown as "Saved" for ~900ms then cleared. */
  readonly savedKey = signal<string | null>(null);

  readonly errorIssues = computed(() => this.designState.validationIssues().filter((issue) => issue.severity === 'error'));
  readonly warningIssues = computed(() => this.designState.validationIssues().filter((issue) => issue.severity !== 'error'));

  constructor(private readonly designState: DesignStateService) {}

  selectIssue(issue: ValidationIssue): void {
    this.navigateToIssue.emit({ tableId: issue.tableId, columnId: issue.columnId, relationshipId: issue.relationshipId });
    this.closeDrawer.emit();
  }

  /** Stable identity for `@for` tracking — issues have no id of their own. */
  issueKey(issue: ValidationIssue): string {
    return `${issue.code}-${issue.tableId ?? ''}-${issue.columnId ?? ''}-${issue.relationshipId ?? ''}-${issue.message}`;
  }

  /** Key used to correlate a fix button with its transient saving/saved indicator. */
  fixKey(issue: ValidationIssue): string {
    return `fix-${this.issueKey(issue)}`;
  }

  canAddIdColumn(issue: ValidationIssue): boolean {
    return issue.code === 'table-without-primary-key' && issue.tableId != null;
  }

  canRenameToSanitized(issue: ValidationIssue): boolean {
    return issue.code === 'invalid-identifier' && (issue.columnId != null || issue.tableId != null);
  }

  addIdColumn(issue: ValidationIssue): void {
    if (issue.tableId == null) {
      return;
    }

    const key = this.fixKey(issue);
    this.beginFix(key);

    this.designState
      .createColumn(issue.tableId, {
        name: 'id',
        sqlType: 'bigint',
        isPrimaryKey: true,
        isNullable: false,
        isUnique: false,
        ordinal: 0,
        sourceColumnName: null,
      })
      .subscribe({
        next: () => this.completeFix(key),
        error: () => this.failFix(),
      });
  }

  renameToSanitized(issue: ValidationIssue): void {
    const key = this.fixKey(issue);
    const currentName = issue.columnId != null ? this.designState.columnName(issue.columnId) : this.designState.tableName(issue.tableId!);
    const sanitized = sanitizeIdentifier(currentName);

    this.beginFix(key);

    const request$ = issue.columnId != null
      ? this.designState.updateColumn(issue.columnId, { name: sanitized })
      : this.designState.updateTable(issue.tableId!, { name: sanitized });

    request$.subscribe({
      next: () => this.completeFix(key),
      error: () => this.failFix(),
    });
  }

  private beginFix(key: string): void {
    this.savingKey.set(key);
    this.savedKey.set(null);
  }

  private completeFix(key: string): void {
    this.savingKey.set(null);
    this.savedKey.set(key);
    window.setTimeout(() => {
      if (this.savedKey() === key) {
        this.savedKey.set(null);
      }
    }, 900);
  }

  private failFix(): void {
    this.savingKey.set(null);
  }
}
