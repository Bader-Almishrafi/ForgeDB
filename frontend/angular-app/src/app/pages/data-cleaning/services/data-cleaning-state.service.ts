import { computed, inject, Injectable, signal } from '@angular/core';
import { CleaningOperationRequest, CleaningStrategy, CleaningSuggestion } from '../../../services/api.models';
import { ProjectWorkflowContextService } from '../../../services/project-workflow-context.service';
import { DataCleaningApiService } from './data-cleaning-api.service';
import {
  buildCleaningOperation,
  extractColumns,
  extractIssueTypes,
  filterSafeRecommendations,
  filterSuggestions,
} from './cleaning-transformations';

export type CleaningScope = 'project' | number;

@Injectable()
export class DataCleaningStateService {
  private readonly api = inject(DataCleaningApiService);
  private readonly workflowContext = inject(ProjectWorkflowContextService);

  readonly scope = signal<CleaningScope>('project');
  readonly scopeNotice = signal('');
  readonly search = signal('');
  readonly issueType = signal('all');
  readonly columnFilter = signal('all');
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly strategyOverrides = signal<Record<string, string>>({});
  readonly customValues = signal<Record<string, string>>({});
  readonly duplicateColumns = signal<Record<string, string>>({});

  readonly selectedDataset = computed(() => {
    const scope = this.scope();
    return typeof scope === 'number' ? this.api.datasets().find((dataset) => dataset.datasetId === scope) ?? null : null;
  });

  readonly scopeSuggestions = computed(() => {
    const scope = this.scope();
    return scope === 'project' ? this.api.suggestions() : this.api.suggestions().filter((suggestion) => suggestion.datasetId === scope);
  });

  readonly issueTypes = computed(() => extractIssueTypes(this.scopeSuggestions()));

  readonly columns = computed(() => extractColumns(this.scopeSuggestions()));

  readonly filteredSuggestions = computed(() =>
    filterSuggestions(this.scopeSuggestions(), this.search(), this.issueType(), this.columnFilter())
  );

  readonly selectedSuggestions = computed(() => this.scopeSuggestions().filter((suggestion) => this.selectedIds().has(suggestion.id)));

  readonly safeRecommendations = computed(() => filterSafeRecommendations(this.scopeSuggestions()));

  readonly allVisibleSelected = computed(() => this.filteredSuggestions().length > 0
    && this.filteredSuggestions().every((suggestion) => this.selectedIds().has(suggestion.id)));

  changeScope(value: CleaningScope): void {
    if (value === 'project') {
      this.scope.set('project');
      this.workflowContext.setDatasetFromQuery(null);
      this.scopeNotice.set('');
      this.resetIssueSelection();
      return;
    }
    const datasetId = Number(value);
    if (!this.api.datasets().some((dataset) => dataset.datasetId === datasetId)) return;
    this.scope.set(datasetId);
    this.workflowContext.setDatasetFromQuery(datasetId);
    this.scopeNotice.set('');
    this.resetIssueSelection();
  }

  updateSearch(value: string): void { this.search.set(value); }
  updateIssueType(value: string): void { this.issueType.set(value); }
  updateColumnFilter(value: string): void { this.columnFilter.set(value); }

  toggleSuggestion(suggestion: CleaningSuggestion): void {
    this.selectedIds.update((selected) => {
      const next = new Set(selected);
      next.has(suggestion.id) ? next.delete(suggestion.id) : next.add(suggestion.id);
      return next;
    });
  }

  toggleAllVisible(): void {
    const select = !this.allVisibleSelected();
    this.selectedIds.update((selected) => {
      const next = new Set(selected);
      for (const suggestion of this.filteredSuggestions()) select ? next.add(suggestion.id) : next.delete(suggestion.id);
      return next;
    });
  }

  updateStrategy(suggestion: CleaningSuggestion, key: string): void {
    this.strategyOverrides.update((current) => ({ ...current, [suggestion.id]: key }));
  }

  selectedStrategy(suggestion: CleaningSuggestion): CleaningStrategy {
    const key = this.strategyOverrides()[suggestion.id] ?? suggestion.recommendedStrategy.key;
    return suggestion.availableStrategies.find((strategy) => strategy.key === key) ?? suggestion.recommendedStrategy;
  }

  updateCustomValue(suggestionId: string, value: string): void {
    this.customValues.update((current) => ({ ...current, [suggestionId]: value }));
  }

  updateDuplicateColumns(suggestionId: string, value: string): void {
    this.duplicateColumns.update((current) => ({ ...current, [suggestionId]: value }));
  }

  resetIssueSelection(): void {
    this.selectedIds.set(new Set());
    this.strategyOverrides.set({});
    this.customValues.set({});
    this.duplicateColumns.set({});
  }

  buildOperation(suggestion: CleaningSuggestion): CleaningOperationRequest {
    const strategy = this.selectedStrategy(suggestion);
    return buildCleaningOperation(
      suggestion,
      strategy,
      this.customValues()[suggestion.id],
      this.duplicateColumns()[suggestion.id]
    );
  }

  buildOperations(suggestions: CleaningSuggestion[]): CleaningOperationRequest[] {
    return suggestions.map((suggestion) => this.buildOperation(suggestion));
  }
}
