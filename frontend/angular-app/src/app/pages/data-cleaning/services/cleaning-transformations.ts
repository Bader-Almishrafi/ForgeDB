import { CleaningOperationRequest, CleaningStrategy, CleaningSuggestion } from '../../../services/api.models';

/**
 * Pure functions and immutable validation transformations for Data Cleaning operations.
 * Follows the established pure logic validation pattern (like schema-draft.ts) to separate DOM/State from rules.
 */

export function extractIssueTypes(suggestions: CleaningSuggestion[]): string[] {
  return [...new Set(suggestions.map((s) => s.issueType))].sort();
}

export function extractColumns(suggestions: CleaningSuggestion[]): string[] {
  return [...new Set(suggestions
    .map((s) => s.column)
    .filter((col): col is string => !!col))].sort();
}

export function filterSuggestions(
  suggestions: CleaningSuggestion[],
  searchQuery: string,
  issueType: string,
  columnFilter: string
): CleaningSuggestion[] {
  const query = searchQuery.trim().toLocaleLowerCase();
  return suggestions.filter((suggestion) => {
    if (issueType !== 'all' && suggestion.issueType !== issueType) return false;
    if (columnFilter !== 'all' && suggestion.column !== columnFilter) return false;
    if (!query) return true;
    const target = `${suggestion.datasetName} ${suggestion.issueType} ${suggestion.column ?? ''} ${suggestion.description}`.toLocaleLowerCase();
    return target.includes(query);
  });
}

export function filterSafeRecommendations(suggestions: CleaningSuggestion[]): CleaningSuggestion[] {
  return suggestions.filter((s) =>
    s.recommendedStrategy.isSafeRecommended && !s.recommendedStrategy.isDestructive
  );
}

export function parseDuplicateColumns(input?: string): string[] {
  if (!input) return [];
  const columns = input.split(',')
    .map((col) => col.trim())
    .filter(Boolean);
  return columns.some((column) => column.toLocaleLowerCase() === 'all') ? [] : columns;
}

export function buildCleaningOperation(
  suggestion: CleaningSuggestion,
  strategy: CleaningStrategy,
  customValue?: string,
  duplicateColumnsInput?: string
): CleaningOperationRequest {
  const parameters = { ...strategy.parameters };
  
  if (parameters['strategy'] === 'custom' || parameters['invalidAction'] === 'replace') {
    parameters['value'] = customValue ?? '';
  }
  
  if (strategy.operationType === 'remove_duplicates') {
    const columns = parseDuplicateColumns(duplicateColumnsInput);
    if (columns.length) {
      parameters['columns'] = columns;
    }
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

export function validateCleaningOperation(operation: CleaningOperationRequest): { valid: boolean; error?: string } {
  if (!operation.suggestionId || !operation.operationType) {
    return { valid: false, error: 'Operation missing required identifiers or strategy type.' };
  }
  const replacement = operation.parameters['value'];
  const needsReplacement = operation.parameters['strategy'] === 'custom'
    || operation.parameters['invalidAction'] === 'replace';
  if (needsReplacement && (replacement === null
    || replacement === undefined
    || (typeof replacement === 'string' && !replacement.trim()))) {
    return { valid: false, error: 'Custom strategy requires a replacement value.' };
  }
  return { valid: true };
}
