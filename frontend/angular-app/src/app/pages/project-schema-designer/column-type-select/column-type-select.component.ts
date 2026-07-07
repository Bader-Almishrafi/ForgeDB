import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';

const CURATED_TYPES = [
  'text',
  'varchar(255)',
  'integer',
  'bigint',
  'numeric(10,2)',
  'boolean',
  'date',
  'timestamp',
  'timestamptz',
  'uuid',
  'jsonb',
] as const;

const ADVANCED_OPTION = 'Advanced…';

/**
 * Reusable SQL-type picker for a single column: a curated dropdown of common PostgreSQL types
 * plus an "Advanced…" escape hatch that reveals a free-text input for anything else (including
 * a value the server rejected, so the user can keep seeing and editing it). Purely presentational
 * — it only reads/writes its own `value` input/output and never touches DesignStateService.
 */
@Component({
  selector: 'app-column-type-select',
  standalone: true,
  imports: [],
  templateUrl: './column-type-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColumnTypeSelectComponent {
  readonly value = input.required<string>();
  readonly disabled = input<boolean>(false);
  readonly valueChange = output<string>();

  readonly curatedTypes = CURATED_TYPES;
  readonly advancedOption = ADVANCED_OPTION;

  /** Set once the user picks "Advanced…" so the free-text input stays revealed even if they
   * then type a value that happens to match a curated option's case-insensitively different form. */
  private readonly forcedAdvanced = signal(false);

  readonly matchedCurated = computed(() => this.findCuratedMatch(this.value()));
  readonly isAdvanced = computed(() => this.forcedAdvanced() || this.matchedCurated() === null);
  readonly selectValue = computed(() => this.matchedCurated() ?? this.advancedOption);

  readonly draftValue = signal('');

  /** Tracks the value we've last emitted (or that arrived from outside), so that Enter followed
   * by a subsequent blur on the same unedited draft emits `valueChange` only once instead of
   * firing a duplicate save before the parent's async round-trip updates `value()`. */
  private readonly lastCommitted = signal('');

  constructor() {
    // Keep the free-text draft in sync whenever the bound value changes from outside (initial
    // load, a successful save round-trip, or a reload after another editor's change) — but not
    // on every local keystroke, since draftValue itself is a separate signal from value().
    effect(() => {
      const current = this.value();
      this.draftValue.set(current);
      this.lastCommitted.set(current);
    });
  }

  onSelectChange(event: Event): void {
    const selected = (event.target as HTMLSelectElement).value;

    if (selected === this.advancedOption) {
      this.forcedAdvanced.set(true);
      this.draftValue.set(this.value());
      return;
    }

    this.forcedAdvanced.set(false);
    this.draftValue.set(selected);
    this.lastCommitted.set(selected);
    this.valueChange.emit(selected);
  }

  onDraftInput(event: Event): void {
    this.draftValue.set((event.target as HTMLInputElement).value);
  }

  commitDraft(): void {
    const draft = this.draftValue();
    if (draft !== this.lastCommitted()) {
      this.lastCommitted.set(draft);
      this.valueChange.emit(draft);
    }
  }

  revertDraft(): void {
    this.draftValue.set(this.value());
  }

  private findCuratedMatch(current: string): string | null {
    const normalized = current.trim().toLowerCase();
    return CURATED_TYPES.find((option) => option.toLowerCase() === normalized) ?? null;
  }
}
