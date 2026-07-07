import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiErrorBody } from '../../../services/api.models';
import { DesignStateService } from '../../../services/design-state.service';

/**
 * Left panel of the master-detail Schema Designer layout: the list of tables in the current
 * design, plus a small inline "add table" form. Reads/writes state only through
 * DesignStateService — no direct HTTP calls.
 */
@Component({
  selector: 'app-table-list-panel',
  standalone: true,
  imports: [NgClass, FormsModule],
  templateUrl: './table-list-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableListPanelComponent {
  readonly selectedTableId = input<number | null>(null);

  readonly selectTable = output<number>();
  readonly tableAdded = output<number>();

  readonly sortedTables = computed(() => [...this.designState.tables()].sort((a, b) => a.id - b.id));

  readonly savingAdd = signal(false);
  readonly savingField = signal<string | null>(null);
  readonly addError = signal<string | null>(null);

  newTableName = '';

  constructor(protected readonly designState: DesignStateService) {}

  onSelect(tableId: number): void {
    this.selectTable.emit(tableId);
  }

  errorCount(tableId: number): number {
    return this.designState.issuesForTable(tableId).filter((issue) => issue.severity === 'error').length;
  }

  warningCount(tableId: number): number {
    return this.designState.issuesForTable(tableId).filter((issue) => issue.severity === 'warning').length;
  }

  addTable(): void {
    const trimmed = this.newTableName.trim();
    if (!trimmed || this.savingAdd()) {
      return;
    }

    this.addError.set(null);
    this.savingAdd.set(true);
    this.savingField.set('newTable');

    this.designState.createTable({ name: trimmed }).subscribe({
      next: (response) => {
        this.savingAdd.set(false);
        this.newTableName = '';
        window.setTimeout(() => this.savingField.set(null), 900);

        const newId = response.tables.reduce((max, table) => Math.max(max, table.id), Number.NEGATIVE_INFINITY);
        if (Number.isFinite(newId)) {
          this.tableAdded.emit(newId);
        }
      },
      error: (err: unknown) => {
        this.savingAdd.set(false);
        this.savingField.set(null);
        this.addError.set(this.extractErrorMessage(err));
      },
    });
  }

  cancelAddTable(): void {
    this.newTableName = '';
    this.addError.set(null);
  }

  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'object' && err !== null && 'error' in err) {
      const body = (err as { error?: ApiErrorBody }).error;
      if (body?.message) {
        return body.message;
      }
    }

    return 'Unable to add table. Please try again.';
  }
}
