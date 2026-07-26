import { computed, inject, Injectable, signal } from '@angular/core';
import { CleaningOperationRequest, CleaningStrategy, CleaningSuggestion } from '../../../services/api.models';
import { ProjectWorkflowContextService } from '../../../services/project-workflow-context.service';
import { DataCleaningApiService } from './data-cleaning-api.service';

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

  readonly issueTypes = computed(() => [...new Set(this.scopeSuggestions().map((suggestion) => suggestion.issueType))].sort());

  readonly columns = computed(() => [...new Set(this.scopeSuggestions()
    .map((suggestion) => suggestion.column)
    .filter((column): column is string => !!column))].sort());

  readonly filteredSuggestions = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return this.scopeSuggestions().filter((suggestion) => {
      if (this.issueType() !== 'all' && suggestion.issueType !== this.issueType()) return false;
      if (this.columnFilter() !== 'all' && suggestion.column !== this.columnFilter()) return false;
      return !query || `${suggestion.datasetName} ${suggestion.issueType} ${suggestion.column ?? ''} ${suggestion.description}`.toLocaleLowerCase().includes(query);
    });
  });

  readonly selectedSuggestions = computed(() => this.scopeSuggestions().filter((suggestion) => this.selectedIds().has(suggestion.id)));

  readonly safeRecommendations = computed(() => this.scopeSuggestions().filter((suggestion) =>
    suggestion.recommendedStrategy.isSafeRecommended && !suggestion.recommendedStrategy.isDestructive));

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
    const parameters = { ...strategy.parameters };
    if (parameters['strategy'] === 'custom' || parameters['invalidAction'] === 'replace') {
      parameters['value'] = this.customValues()[suggestion.id] ?? '';
    }
    if (strategy.operationType === 'remove_duplicates') {
      const columns = this.duplicateColumns()[suggestion.id]?.split(',').map((col) => col.trim()).filter(Boolean);
      if (columns?.length) parameters['columns'] = columns;
    }
    return {
      operationId: suggestion.id,
      suggestionId: suggestion.id,
      datasetId: suggestion.datasetId,
      expectedSourceVersionId: suggestion.versionId,
      operationType: strategy.operationType,
      column: suggestion.column,
      parameters,
    };
  }

  buildOperations(suggestions: CleaningSuggestion[]): CleaningOperationRequest[] {
    return suggestions.map((suggestion) => this.buildOperation(suggestion));
  }
}
