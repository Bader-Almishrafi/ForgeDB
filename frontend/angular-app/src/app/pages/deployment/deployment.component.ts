import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, DatasetPreview, DeploymentResponse, ProjectResponse, SchemaRelationship, SchemaResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { SchemaExportService } from '../../services/schema-export.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-deployment',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './deployment.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeploymentComponent implements OnInit {
  readonly schema = signal<SchemaResponse | null>(null);
  readonly project = signal<ProjectResponse | null>(null);
  readonly dataset = signal<DatasetPreview | null>(null);
  readonly deployment = signal<DeploymentResponse | null>(null);
  readonly loading = signal(false);
  readonly generating = signal(false);
  readonly copied = signal(false);

  schemaId = 0;
  databaseName = '';
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
    this.schemaId = Number(this.route.snapshot.paramMap.get('schemaId'));
    if (!Number.isFinite(this.schemaId) || this.schemaId <= 0) {
      this.router.navigate(['/projects']);
      return;
    }

    this.loadSchema();
  }

  loadSchema(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getSchema(this.schemaId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (schema) => {
          this.schema.set(schema);
          this.workflow.setSchema(schema);
          this.databaseName = this.databaseName || schema.schemaName;
          this.loadSummary(schema);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load schema.';
        },
      });
  }

  generateDeploymentSql(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.generating.set(true);

    this.api.deploySchema(this.schemaId, { databaseName: this.databaseName })
      .pipe(finalize(() => this.generating.set(false)))
      .subscribe({
        next: (deployment) => {
          this.deployment.set(deployment);
          this.successMessage = 'Deployment SQL generated.';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to generate deployment SQL.';
        },
      });
  }

  sqlScript(): string {
    const schema = this.schema();
    return schema ? this.schemaExport.sqlText(schema, this.deployment()) : '';
  }

  dbmlText(): string {
    const schema = this.schema();
    return schema ? this.schemaExport.dbmlText(schema) : '';
  }

  jsonText(): string {
    const schema = this.schema();
    return schema
      ? this.schemaExport.schemaJsonText(schema, this.project(), this.dataset(), this.deployment())
      : '';
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

  copySql(): void {
    const sql = this.sqlScript();
    if (!sql) {
      return;
    }

    navigator.clipboard.writeText(sql)
      .then(() => {
        this.copied.set(true);
        window.setTimeout(() => this.copied.set(false), 2000);
      })
      .catch(() => {
        this.errorMessage = 'Unable to copy SQL in this browser.';
      });
  }

  downloadSql(): void {
    this.schemaExport.downloadText('forgedb-schema.sql', this.sqlScript(), 'text/sql;charset=utf-8');
  }

  downloadDbml(): void {
    this.schemaExport.downloadText('forgedb-schema.dbml', this.dbmlText(), 'text/plain;charset=utf-8');
  }

  downloadJson(): void {
    this.schemaExport.downloadText('forgedb-schema.json', this.jsonText(), 'application/json;charset=utf-8');
  }

  private loadSummary(schema: SchemaResponse): void {
    this.api.getProject(schema.projectId).subscribe({
      next: (project) => {
        this.project.set(project);
        this.workflow.setProject(project);
      },
      error: () => this.project.set(null),
    });

    this.api.getDatasetPreview(schema.datasetId).subscribe({
      next: (dataset) => {
        this.dataset.set(dataset);
        this.workflow.setDatasetId(dataset.datasetId, dataset.tableName);
      },
      error: () => this.dataset.set(null),
    });
  }
}
