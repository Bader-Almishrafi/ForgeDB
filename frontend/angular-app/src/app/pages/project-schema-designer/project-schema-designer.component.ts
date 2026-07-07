import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import { ApiErrorBody, DesignModelResponse, ProjectRelationshipSuggestion, ProjectSchema, ProjectSchemaColumn, ProjectSchemaTable } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { DesignApiService } from '../../services/design-api.service';
import { mapDesignToProjectSchema } from '../../services/design-view-model';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-project-schema-designer',
  standalone: true,
  imports: [NgClass, RouterLink],
  templateUrl: './project-schema-designer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectSchemaDesignerComponent implements OnInit {
  readonly schema = signal<ProjectSchema | null>(null);
  readonly loading = signal(false);
  readonly generating = signal(false);
  readonly activePreview = signal<'sql' | 'dbml' | 'json'>('sql');
  readonly copied = signal(false);

  private projectName = '';

  projectId = 0;
  errorMessage = '';
  successMessage = '';

  constructor(
    private api: ForgeApiService,
    private designApi: DesignApiService,
    private route: ActivatedRoute,
    private router: Router,
    private workflow: WorkflowStateService,
  ) {}

  ngOnInit(): void {
    this.projectId = Number(this.route.snapshot.paramMap.get('projectId'));
    if (!Number.isFinite(this.projectId) || this.projectId <= 0) {
      this.router.navigate(['/projects']);
      return;
    }

    this.workflow.setProjectId(this.projectId);
    this.loadSchema();
  }

  loadSchema(): void {
    this.errorMessage = '';
    this.loading.set(true);

    forkJoin({
      project: this.api.getProject(this.projectId),
      design: this.designApi.getDesign(this.projectId).pipe(catchError(() => of(null))),
    })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ project, design }) => {
          this.projectName = project.name;
          this.applyDesign(design);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load project schema.';
        },
      });
  }

  generateSchema(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.generating.set(true);

    this.designApi.generateDesign(this.projectId, 'merge')
      .pipe(finalize(() => this.generating.set(false)))
      .subscribe({
        next: (design) => {
          this.applyDesign(design);
          this.successMessage = 'Project schema generated.';
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to generate project schema.';
        },
      });
  }

  previewText(_schema: ProjectSchema): string {
    return this.previewCache[this.activePreview()];
  }

  private previewCache: Record<'sql' | 'dbml' | 'json', string> = { sql: '', dbml: '', json: '' };

  private applyDesign(design: DesignModelResponse | null): void {
    this.schema.set(design ? mapDesignToProjectSchema(design, this.projectId, this.projectName) : null);

    if (!design) {
      this.previewCache = { sql: '', dbml: '', json: '' };
      return;
    }

    forkJoin({
      sql: this.designApi.getPreview(design.id, 'sql').pipe(catchError(() => of(''))),
      dbml: this.designApi.getPreview(design.id, 'dbml').pipe(catchError(() => of(''))),
      json: this.designApi.getPreview(design.id, 'json').pipe(catchError(() => of(''))),
    }).subscribe((previews) => {
      this.previewCache = previews;
    });
  }

  relationshipLabel(relationship: ProjectRelationshipSuggestion): string {
    return `${relationship.fromTable}.${relationship.fromColumn} \u2192 ${relationship.toTable}.${relationship.toColumn}`;
  }

  totalColumns(schema: ProjectSchema): number {
    return schema.tables.reduce((total, table) => total + table.columns.length, 0);
  }

  primaryKeyCandidateCount(schema: ProjectSchema): number {
    return schema.tables.reduce((total, table) => total + table.primaryKeyCandidates.length, 0);
  }

  requiredColumnCount(table: ProjectSchemaTable): number {
    return table.columns.filter((column) => !column.isNullable).length;
  }

  columnTypeClass(column: ProjectSchemaColumn): string {
    const type = column.detectedDataType.toLowerCase();
    if (type.includes('int') || type.includes('decimal') || type.includes('number')) {
      return 'bg-sky-50 text-sky-700 ring-sky-200';
    }

    if (type.includes('date') || type.includes('time')) {
      return 'bg-violet-50 text-violet-700 ring-violet-200';
    }

    if (type.includes('bool')) {
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    }

    return 'bg-slate-100 text-slate-700 ring-slate-200';
  }

  copyPreview(schema: ProjectSchema): void {
    navigator.clipboard.writeText(this.previewText(schema))
      .then(() => {
        this.copied.set(true);
        window.setTimeout(() => this.copied.set(false), 2000);
      })
      .catch(() => {
        this.errorMessage = 'Unable to copy in this browser.';
      });
  }
}
