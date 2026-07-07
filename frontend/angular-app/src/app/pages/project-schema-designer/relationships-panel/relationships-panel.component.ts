import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiErrorBody, DesignColumn, DesignRelationship } from '../../../services/api.models';
import { DesignStateService } from '../../../services/design-state.service';

const CARDINALITY_OPTIONS = ['many-to-one', 'one-to-one'] as const;
const ON_DELETE_OPTIONS = ['no-action', 'cascade', 'set-null'] as const;

interface NewRelationshipDraft {
  fromColumnId: number | null;
  targetTableId: number | null;
  toColumnId: number | null;
  cardinality: string;
  onDelete: string;
}

function emptyDraft(): NewRelationshipDraft {
  return {
    fromColumnId: null,
    targetTableId: null,
    toColumnId: null,
    cardinality: CARDINALITY_OPTIONS[0],
    onDelete: ON_DELETE_OPTIONS[0],
  };
}

/**
 * Embedded panel (used inside the table editor) that lists and manages every relationship
 * touching a single table: inline cardinality/onDelete edits, delete, and a "create
 * relationship" form scoped to this table's own columns as the "from" side. Works standalone
 * given just `tableId` — reads/writes state only through DesignStateService.
 */
@Component({
  selector: 'app-relationships-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './relationships-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelationshipsPanelComponent {
  readonly tableId = input.required<number>();

  readonly cardinalityOptions = CARDINALITY_OPTIONS;
  readonly onDeleteOptions = ON_DELETE_OPTIONS;

  readonly relationships = computed(() => this.designState.relationshipsForTable(this.tableId()));
  readonly ownColumns = computed(() => this.designState.columnsForTable(this.tableId()));
  readonly targetTables = computed(() => this.designState.tables().filter((table) => table.id !== this.tableId()));

  /** Key of the edit/create currently in flight, shown as "Saving...". */
  readonly savingKey = signal<string | null>(null);
  /** Key of the edit/create that just succeeded, shown as "Saved" for ~900ms then cleared. */
  readonly savedKey = signal<string | null>(null);

  readonly rowError = signal<string | null>(null);
  readonly createError = signal<string | null>(null);

  newRelationship: NewRelationshipDraft = emptyDraft();

  constructor(private readonly designState: DesignStateService) {}

  /** Target-column options depend on the (non-signal) draft's chosen target table, so this
   * stays a plain method re-evaluated on every check rather than a memoized `computed()`. */
  targetColumns(): DesignColumn[] {
    const targetTableId = this.newRelationship.targetTableId;
    return targetTableId == null ? [] : this.designState.columnsForTable(targetTableId);
  }

  directionLabel(rel: DesignRelationship): string {
    if (rel.fromTableId === this.tableId()) {
      return `This table → ${rel.toTableName}.${rel.toColumnName}`;
    }

    return `${rel.fromTableName}.${rel.fromColumnName} → This table`;
  }

  cardinalityKey(relationshipId: number): string {
    return `cardinality-${relationshipId}`;
  }

  onDeleteKey(relationshipId: number): string {
    return `onDelete-${relationshipId}`;
  }

  deleteKey(relationshipId: number): string {
    return `delete-${relationshipId}`;
  }

  onCardinalityChange(rel: DesignRelationship, value: string): void {
    if (value === rel.cardinality) {
      return;
    }

    const key = this.cardinalityKey(rel.id);
    this.rowError.set(null);
    this.beginSave(key);

    this.designState.updateRelationship(rel.id, { cardinality: value }).subscribe({
      next: () => this.completeSave(key),
      error: (err: unknown) => {
        this.savingKey.set(null);
        this.rowError.set(this.extractErrorMessage(err));
      },
    });
  }

  onOnDeleteChange(rel: DesignRelationship, value: string): void {
    if (value === rel.onDelete) {
      return;
    }

    const key = this.onDeleteKey(rel.id);
    this.rowError.set(null);
    this.beginSave(key);

    this.designState.updateRelationship(rel.id, { onDelete: value }).subscribe({
      next: () => this.completeSave(key),
      error: (err: unknown) => {
        this.savingKey.set(null);
        this.rowError.set(this.extractErrorMessage(err));
      },
    });
  }

  deleteRelationship(rel: DesignRelationship): void {
    if (!window.confirm('Delete this relationship?')) {
      return;
    }

    const key = this.deleteKey(rel.id);
    this.rowError.set(null);
    this.beginSave(key);

    this.designState.deleteRelationship(rel.id).subscribe({
      next: () => this.savingKey.set(null),
      error: (err: unknown) => {
        this.savingKey.set(null);
        this.rowError.set(this.extractErrorMessage(err));
      },
    });
  }

  createRelationship(): void {
    const { fromColumnId, toColumnId, cardinality, onDelete } = this.newRelationship;
    if (fromColumnId == null || toColumnId == null) {
      this.createError.set('Choose a column on this table and a target column.');
      return;
    }

    const key = 'create';
    this.createError.set(null);
    this.beginSave(key);

    this.designState.createRelationship({ fromColumnId, toColumnId, cardinality, onDelete }).subscribe({
      next: () => {
        this.completeSave(key);
        this.newRelationship = emptyDraft();
      },
      error: (err: unknown) => {
        this.savingKey.set(null);
        this.createError.set(this.extractErrorMessage(err));
      },
    });
  }

  onTargetTableChange(targetTableId: number | null): void {
    this.newRelationship = { ...this.newRelationship, targetTableId, toColumnId: null };
  }

  private beginSave(key: string): void {
    this.savingKey.set(key);
    this.savedKey.set(null);
  }

  private completeSave(key: string): void {
    this.savingKey.set(null);
    this.savedKey.set(key);
    window.setTimeout(() => {
      if (this.savedKey() === key) {
        this.savedKey.set(null);
      }
    }, 900);
  }

  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'object' && err !== null && 'error' in err) {
      const body = (err as { error?: ApiErrorBody }).error;
      if (body?.message) {
        return body.message;
      }
    }

    return 'Something went wrong. Please try again.';
  }
}
