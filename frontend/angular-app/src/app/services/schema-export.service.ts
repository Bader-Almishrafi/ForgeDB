import { Injectable } from '@angular/core';
import { DatasetPreview, DeploymentResponse, ProjectResponse, SchemaColumn, SchemaRelationship, SchemaResponse } from './api.models';

@Injectable({ providedIn: 'root' })
export class SchemaExportService {
  sqlText(schema: SchemaResponse, deployment?: DeploymentResponse | null): string {
    return deployment?.sqlScript || schema.sqlContent || schema.sqlPreview || '';
  }

  dbmlText(schema: SchemaResponse): string {
    if (schema.dbmlContent?.trim()) {
      return schema.dbmlContent;
    }

    const tableName = this.dbmlIdentifier(schema.generatedTableName);
    const columnLines = schema.generatedColumns.map((column) => this.dbmlColumn(column));
    const relationshipLines = this.relationships(schema).map((relationship, index) => this.dbmlRelationship(relationship, index));

    return [
      `Project ${this.dbmlIdentifier(schema.schemaName || 'ForgeDB')} {`,
      '  database_type: "PostgreSQL"',
      '}',
      '',
      `Table ${tableName} {`,
      ...columnLines,
      '}',
      relationshipLines.length ? '' : null,
      ...relationshipLines,
    ].filter((line): line is string => line !== null).join('\n');
  }

  schemaJsonText(
    schema: SchemaResponse,
    project?: ProjectResponse | null,
    dataset?: DatasetPreview | null,
    deployment?: DeploymentResponse | null,
  ): string {
    if (schema.schemaJson?.trim() && !project && !dataset && !deployment) {
      return schema.schemaJson;
    }

    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      product: 'ForgeDB',
      project: project ? {
        id: project.id,
        name: project.name,
        description: project.description ?? null,
      } : null,
      dataset: dataset ? {
        id: dataset.datasetId,
        tableName: dataset.tableName,
        columns: dataset.columns,
        previewRowCount: dataset.rows.length,
      } : {
        id: schema.datasetId,
      },
      schema: {
        id: schema.schemaId,
        name: schema.schemaName,
        status: schema.status,
        version: schema.version,
        generatedTableName: schema.generatedTableName,
        generatedColumns: schema.generatedColumns,
        relationships: this.relationships(schema),
        sqlPreview: this.sqlText(schema, deployment),
        dbml: this.dbmlText(schema),
      },
      deployment: deployment ? {
        id: deployment.deploymentId,
        databaseName: deployment.databaseName,
        status: deployment.status,
        createdAt: deployment.createdAt,
        deployedAt: deployment.deployedAt ?? null,
      } : null,
    }, null, 2);
  }

  downloadText(fileName: string, content: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  relationships(schema: SchemaResponse): SchemaRelationship[] {
    return Array.isArray(schema.relationships) ? schema.relationships : [];
  }

  relationshipLabel(relationship: SchemaRelationship): string {
    return `${relationship.fromTable}.${relationship.fromColumn} -> ${relationship.toTable}.${relationship.toColumn}`;
  }

  private dbmlColumn(column: SchemaColumn): string {
    const settings = column.isNullable ? '' : ' [not null]';
    return `  ${this.dbmlIdentifier(column.name)} ${this.dbmlType(column.sqlType)}${settings}`;
  }

  private dbmlRelationship(relationship: SchemaRelationship, index: number): string {
    const name = relationship.name || `relationship_${index + 1}`;
    return [
      `Ref ${this.dbmlIdentifier(name)}:`,
      `${this.dbmlIdentifier(relationship.fromTable)}.${this.dbmlIdentifier(relationship.fromColumn)}`,
      '>',
      `${this.dbmlIdentifier(relationship.toTable)}.${this.dbmlIdentifier(relationship.toColumn)}`,
    ].join(' ');
  }

  private dbmlType(sqlType: string): string {
    return (sqlType || 'text').replace(/\s+/g, '_').toLowerCase();
  }

  private dbmlIdentifier(value: string): string {
    const identifier = value?.trim() || 'unnamed';
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
      return identifier;
    }

    return `"${identifier.replace(/"/g, '\\"')}"`;
  }
}
