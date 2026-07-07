import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import { ApiErrorBody, ProjectRelationshipSuggestion, ProjectSchema } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { DesignApiService } from '../../services/design-api.service';
import { mapDesignToProjectSchema } from '../../services/design-view-model';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-project-er-diagram',
  standalone: true,
  imports: [NgClass, RouterLink],
  templateUrl: './project-er-diagram.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectErDiagramComponent implements OnInit {
  readonly schema = signal<ProjectSchema | null>(null);
  readonly loading = signal(false);
  readonly zoom = signal(100);

  projectId = 0;
  errorMessage = '';

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
          this.schema.set(design ? mapDesignToProjectSchema(design, this.projectId, project.name) : null);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load ER diagram.';
        },
      });
  }

  relationshipLabel(relationship: ProjectRelationshipSuggestion): string {
    return `${relationship.fromTable}.${relationship.fromColumn} \u2192 ${relationship.toTable}.${relationship.toColumn}`;
  }

  zoomIn(): void {
    this.zoom.update((value) => Math.min(140, value + 10));
  }

  zoomOut(): void {
    this.zoom.update((value) => Math.max(70, value - 10));
  }

  resetZoom(): void {
    this.zoom.set(100);
  }

  canvasWidth(schema: ProjectSchema): number {
    const columns = Math.min(Math.max(schema.tables.length, 1), 3);
    return columns * 360 + 48;
  }

  canvasHeight(schema: ProjectSchema): number {
    const rows = Math.ceil(Math.max(schema.tables.length, 1) / 3);
    return rows * 360 + 64;
  }

  tableLeft(index: number): number {
    return (index % 3) * 360 + 24;
  }

  tableTop(index: number): number {
    return Math.floor(index / 3) * 360 + 24;
  }

  relationshipPath(schema: ProjectSchema, relationship: ProjectRelationshipSuggestion): string {
    const fromIndex = this.tableIndex(schema, relationship.fromTable);
    const toIndex = this.tableIndex(schema, relationship.toTable);
    if (fromIndex < 0 || toIndex < 0) {
      return '';
    }

    const x1 = this.tableLeft(fromIndex) + 312;
    const y1 = this.tableTop(fromIndex) + 76;
    const x2 = this.tableLeft(toIndex);
    const y2 = this.tableTop(toIndex) + 76;
    const delta = Math.max(Math.abs(x2 - x1) * 0.4, 90);

    return `M ${x1} ${y1} C ${x1 + delta} ${y1}, ${x2 - delta} ${y2}, ${x2} ${y2}`;
  }

  relationshipMidpoint(schema: ProjectSchema, relationship: ProjectRelationshipSuggestion): { x: number; y: number } {
    const fromIndex = this.tableIndex(schema, relationship.fromTable);
    const toIndex = this.tableIndex(schema, relationship.toTable);
    if (fromIndex < 0 || toIndex < 0) {
      return { x: 24, y: 24 };
    }

    return {
      x: (this.tableLeft(fromIndex) + this.tableLeft(toIndex)) / 2 + 132,
      y: (this.tableTop(fromIndex) + this.tableTop(toIndex)) / 2 + 70,
    };
  }

  columnBadgeClass(sqlType: string): string {
    const type = sqlType.toLowerCase();
    if (type.includes('int') || type.includes('decimal') || type.includes('numeric')) {
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

  private tableIndex(schema: ProjectSchema, tableName: string): number {
    return schema.tables.findIndex((table) => table.tableName.toLowerCase() === tableName.toLowerCase());
  }
}
