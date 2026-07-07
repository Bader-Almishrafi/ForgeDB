import {
  DesignModelResponse,
  DesignRelationship,
  DesignTable,
  ProjectRelationshipSuggestion,
  ProjectSchema,
  ProjectSchemaColumn,
  ProjectSchemaTable,
  RelationshipSuggestion,
} from './api.models';

/**
 * Maps the Phase 1 Design API response onto the pre-existing `ProjectSchema` view-model shape
 * so `project-schema-designer` and `project-er-diagram` keep their current templates untouched.
 * `detectedDataType` no longer exists on a design column (only `sqlType` does); the lower-cased
 * sqlType is passed through as a reasonable stand-in for the type-based badge coloring.
 */
export function mapDesignToProjectSchema(design: DesignModelResponse, projectId: number, projectName: string): ProjectSchema {
  const tableNameById = new Map(design.tables.map((table) => [table.id, table.name]));

  return {
    projectId,
    projectName,
    status: design.tables.length > 0 ? 'generated' : 'empty',
    tables: design.tables.map((table) => mapTable(table)),
    relationships: design.relationships.map((relationship) => mapRelationship(relationship, tableNameById)),
    sqlPreview: '',
    dbmlPreview: '',
    jsonPreview: '',
  };
}

function mapTable(table: DesignTable): ProjectSchemaTable {
  return {
    datasetId: table.sourceDatasetId ?? table.id,
    tableName: table.name,
    status: table.origin,
    columns: table.columns.map((column): ProjectSchemaColumn => ({
      name: column.name,
      sourceColumnName: column.sourceColumnName ?? column.name,
      detectedDataType: column.sqlType.toLowerCase(),
      sqlType: column.sqlType,
      isNullable: column.isNullable,
      isPrimaryKeyCandidate: column.isPrimaryKey,
    })),
    primaryKeyCandidates: table.columns.filter((column) => column.isPrimaryKey).map((column) => column.name),
  };
}

function mapRelationship(relationship: DesignRelationship, tableNameById: Map<number, string>): ProjectRelationshipSuggestion {
  return {
    suggestionId: String(relationship.id),
    fromDatasetId: relationship.fromTableId,
    fromTable: tableNameById.get(relationship.fromTableId) ?? relationship.fromTableName,
    fromColumn: relationship.fromColumnName,
    toDatasetId: relationship.toTableId,
    toTable: tableNameById.get(relationship.toTableId) ?? relationship.toTableName,
    toColumn: relationship.toColumnName,
    relationshipType: relationship.cardinality,
    confidence: 1,
    reasons: [],
    status: 'accepted',
  };
}

export function mapSuggestion(suggestion: RelationshipSuggestion): ProjectRelationshipSuggestion {
  return {
    suggestionId: String(suggestion.id),
    fromDatasetId: suggestion.sourceDatasetId,
    fromTable: suggestion.sourceTableName,
    fromColumn: suggestion.sourceColumnName,
    toDatasetId: suggestion.targetDatasetId,
    toTable: suggestion.targetTableName,
    toColumn: suggestion.targetColumnName,
    relationshipType: 'many-to-one',
    confidence: suggestion.score,
    reasons: parseReasons(suggestion.evidenceJson),
    status: suggestion.status,
  };
}

function parseReasons(evidenceJson: string | null | undefined): string[] {
  if (!evidenceJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(evidenceJson) as { reasons?: unknown };
    return Array.isArray(parsed.reasons) ? parsed.reasons.filter((reason): reason is string => typeof reason === 'string') : [];
  } catch {
    return [];
  }
}
