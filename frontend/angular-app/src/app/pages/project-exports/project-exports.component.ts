import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectExportPackage } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { SchemaExportService } from '../../services/schema-export.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-project-exports',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './project-exports.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectExportsComponent implements OnInit {
  readonly exportPackage = signal<ProjectExportPackage | null>(null);
  readonly loading = signal(false);
  readonly copiedTarget = signal<'sql' | 'dbml' | 'json' | 'relationships' | 'quality' | null>(null);
  readonly activePreview = signal<'sql' | 'dbml' | 'json' | 'relationships' | 'quality'>('sql');

  projectId = 0;
  errorMessage = '';

  constructor(
    private api: ForgeApiService,
    private route: ActivatedRoute,
    private router: Router,
    private schemaExport: SchemaExportService,
    private workflow: WorkflowStateService,
  ) {}

  ngOnInit(): void {
    this.projectId = Number(this.route.snapshot.paramMap.get('projectId'));
    if (!Number.isFinite(this.projectId) || this.projectId <= 0) {
      this.router.navigate(['/projects']);
      return;
    }

    this.workflow.setProjectId(this.projectId);
    this.loadPackage();
  }

  loadPackage(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getProjectExportPackage(this.projectId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (exportPackage) => this.exportPackage.set(exportPackage),
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load export package.';
        },
      });
  }

  download(fileName: string, content: string, mimeType: string): void {
    this.schemaExport.downloadText(fileName, content, mimeType);
  }

  previewText(exportPackage: ProjectExportPackage): string {
    if (this.activePreview() === 'dbml') {
      return exportPackage.dbml;
    }

    if (this.activePreview() === 'json') {
      return exportPackage.jsonSchema;
    }

    if (this.activePreview() === 'relationships') {
      return exportPackage.relationshipReportJson;
    }

    if (this.activePreview() === 'quality') {
      return exportPackage.dataQualityReportJson;
    }

    return exportPackage.sql;
  }

  previewFileName(): string {
    if (this.activePreview() === 'dbml') {
      return 'schema.dbml';
    }

    if (this.activePreview() === 'json') {
      return 'schema.json';
    }

    if (this.activePreview() === 'relationships') {
      return 'relationship-report.json';
    }

    if (this.activePreview() === 'quality') {
      return 'data-quality-report.json';
    }

    return 'schema.sql';
  }

  artifactCount(exportPackage: ProjectExportPackage): number {
    return [
      exportPackage.sql,
      exportPackage.dbml,
      exportPackage.jsonSchema,
      exportPackage.relationshipReportJson,
      exportPackage.dataQualityReportJson,
    ].filter((content) => content.trim().length > 0).length;
  }

  copy(content: string, target: 'sql' | 'dbml' | 'json' | 'relationships' | 'quality'): void {
    navigator.clipboard.writeText(content)
      .then(() => {
        this.copiedTarget.set(target);
        window.setTimeout(() => this.copiedTarget.set(null), 2000);
      })
      .catch(() => {
        this.errorMessage = 'Unable to copy in this browser.';
      });
  }
}
