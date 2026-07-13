import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, DatasetPreview, SchemaColumn, SchemaRelationship, SchemaResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { SchemaExportService } from '../../services/schema-export.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

type SchemaReviewTab = 'tables' | 'sql' | 'er' | 'constraints' | 'export';

interface DiagramTable {
  name: string;
  columns: DiagramColumn[];
}

interface DiagramColumn {
  name: string;
  sqlType: string | null;
  isNullable: boolean | null;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
}

@Component({
  selector: 'app-schema-review',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './schema-review.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchemaReviewComponent implements OnInit {
  readonly activeTab = signal<SchemaReviewTab>('tables');
  readonly schema = signal<SchemaResponse | null>(null);
  readonly preview = signal<DatasetPreview | null>(null);
  readonly loading = signal(false);
  readonly generating = signal(false);
  readonly copiedTarget = signal<'sql' | 'dbml' | null>(null);

  datasetId = 0;
  schemaName = '';
  errorMessage = '';
  successMessage = '';

  constructor(
    private api: ForgeApiService,
    private route: ActivatedRoute,
    private router: Router,
    private schemaExport: SchemaExportService,
    private workflow: WorkflowStateService,
  ) {}

  ngOnInit(): void {
    this.datasetId = Number(this.route.snapshot.paramMap.get('datasetId'));
    if (!Number.isFinite(this.datasetId) || this.datasetId <= 0) {
      this.router.navigate(['/projects']);
      return;
    }

    this.workflow.setDatasetId(this.datasetId);
    this.loadPreview(this.datasetId);
    this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');
      if (this.isTab(tab)) {
        this.activeTab.set(tab);
      }
    });

    const rememberedSchemaId = this.workflow.datasetId() === this.datasetId ? this.workflow.schemaId() : null;
    const schemaId = Number(this.route.snapshot.queryParamMap.get('schemaId') ?? rememberedSchemaId);
    if (Number.isFinite(schemaId) && schemaId > 0) {
      this.loadSchema(schemaId);
    } else {
      this.loadLatestDatasetSchema();
    }
  }

  setTab(tab: SchemaReviewTab): void {
    this.activeTab.set(tab);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  generateSchema(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.generating.set(true);

    this.api.generateSchema(this.datasetId, {
      schemaName: this.schemaName || `dataset_${this.datasetId}_schema`,
    }).pipe(finalize(() => this.generating.set(false)))
      .subscribe({
        next: (schema) => {
          this.schema.set(schema);
          this.schemaName = schema.schemaName;
          this.workflow.setSchema(schema);
          this.loadPreview(schema.datasetId);
          this.successMessage = 'Schema generated.';
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { schemaId: schema.schemaId, tab: this.activeTab() },
            replaceUrl: true,
          });
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to generate schema.';
        },
      });
  }

  loadSchema(schemaId: number): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getSchema(schemaId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (schema) => {
          this.schema.set(schema);
          this.schemaName = schema.schemaName;
          this.workflow.setSchema(schema);
          this.loadPreview(schema.datasetId);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load schema.';
        },
      });
  }

  loadLatestDatasetSchema(): void {
    this.api.getDatasetSchema(this.datasetId).subscribe({
      next: (schema) => {
        this.schema.set(schema);
        this.schemaName = schema.schemaName;
        this.workflow.setSchema(schema);
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { schemaId: schema.schemaId, tab: this.activeTab() },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      },
      error: () => {
        this.schema.set(null);
      },
    });
  }

  sqlText(schema: SchemaResponse): string {
    return this.schemaExport.sqlText(schema);
  }

  dbmlText(schema: SchemaResponse): string {
    return this.schemaExport.dbmlText(schema);
  }

  relationships(schema: SchemaResponse): SchemaRelationship[] {
    return this.schemaExport.relationships(schema);
  }

  relationshipLabel(relationship: SchemaRelationship): string {
    return this.schemaExport.relationshipLabel(relationship);
  }

  relationshipTypeLabel(relationship: SchemaRelationship): string {
    return this.schemaExport.relationshipTypeLabel(relationship);
  }

  sampleValues(column: SchemaColumn): string[] {
    const preview = this.preview();
    if (!preview) {
      return [];
    }

    const keys = [column.sourceColumnName, column.name].filter(Boolean);
    const values = preview.rows
      .map((row) => {
        const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(row, candidate));
        const value = key ? row[key] : null;
        return value === null || value === undefined ? '' : String(value).trim();
      })
      .filter((value) => value.length > 0);

    return Array.from(new Set(values)).slice(0, 3);
  }

  diagramTables(schema: SchemaResponse): DiagramTable[] {
    const tables = new Map<string, Map<string, DiagramColumn>>();
    const generatedColumns = new Map(schema.generatedColumns.map((column): [string, SchemaColumn] => [column.name, column]));
    const foreignKeys = new Set(this.relationships(schema).map(r => `${r.fromTable}.${r.fromColumn}`));

    tables.set(
      schema.generatedTableName,
      new Map(schema.generatedColumns.map((column): [string, DiagramColumn] => [
        column.name,
        {
          name: column.name,
          sqlType: column.sqlType || null,
          isNullable: column.isNullable,
          isPrimaryKey: column.name.toLowerCase() === 'id' || column.name.toLowerCase() === `${schema.generatedTableName.toLowerCase()}_id`,
          isForeignKey: foreignKeys.has(`${schema.generatedTableName}.${column.name}`),
        },
      ])),
    );

    this.relationships(schema).forEach((relationship) => {
      this.addDiagramColumn(tables, generatedColumns, schema.generatedTableName, relationship.fromTable, relationship.fromColumn, foreignKeys);
      this.addDiagramColumn(tables, generatedColumns, schema.generatedTableName, relationship.toTable, relationship.toColumn, foreignKeys);
    });

    return Array.from(tables.entries()).map(([name, columns]) => ({
      name,
      columns: Array.from(columns.values()),
    }));
  }

  copySql(schema: SchemaResponse): void {
    this.copyText(this.sqlText(schema), 'sql');
  }

  copyDbml(schema: SchemaResponse): void {
    this.copyText(this.dbmlText(schema), 'dbml');
  }

  downloadSql(schema: SchemaResponse): void {
    this.schemaExport.downloadText('forgedb-schema.sql', this.sqlText(schema), 'text/sql;charset=utf-8');
  }

  downloadDbml(schema: SchemaResponse): void {
    this.schemaExport.downloadText('forgedb-schema.dbml', this.dbmlText(schema), 'text/plain;charset=utf-8');
  }

  downloadJson(schema: SchemaResponse): void {
    this.schemaExport.downloadText(
      'forgedb-schema.json',
      this.schemaExport.schemaJsonText(schema, null, this.preview()),
      'application/json;charset=utf-8',
    );
  }

  private copyText(text: string, target: 'sql' | 'dbml'): void {
    if (!text) {
      return;
    }

    navigator.clipboard.writeText(text)
      .then(() => {
        this.copiedTarget.set(target);
        window.setTimeout(() => this.copiedTarget.set(null), 2000);
      })
      .catch(() => {
        this.errorMessage = 'Unable to copy in this browser.';
      });
  }

  private loadPreview(datasetId: number): void {
    this.api.getDatasetPreview(datasetId).subscribe({
      next: (preview) => this.preview.set(preview),
      error: () => this.preview.set(null),
    });
  }

  private addDiagramColumn(
    tables: Map<string, Map<string, DiagramColumn>>,
    generatedColumns: Map<string, SchemaColumn>,
    generatedTableName: string,
    table: string,
    column: string,
    foreignKeys: Set<string>,
  ): void {
    const tableName = table || 'unknown_table';
    const columnName = column || 'unknown_column';

    if (!tables.has(tableName)) {
      tables.set(tableName, new Map<string, DiagramColumn>());
    }

    if (!tables.get(tableName)?.has(columnName)) {
      const generatedColumn = tableName === generatedTableName ? generatedColumns.get(columnName) : null;
      tables.get(tableName)?.set(columnName, {
        name: columnName,
        sqlType: generatedColumn?.sqlType || null,
        isNullable: generatedColumn ? generatedColumn.isNullable : null,
        isPrimaryKey: columnName.toLowerCase() === 'id' || columnName.toLowerCase() === `${tableName.toLowerCase()}_id`,
        isForeignKey: foreignKeys.has(`${tableName}.${columnName}`),
      });
    }
  }

  private isTab(tab: string | null): tab is SchemaReviewTab {
    return tab === 'tables' || tab === 'sql' || tab === 'er' || tab === 'constraints' || tab === 'export';
  }
}
