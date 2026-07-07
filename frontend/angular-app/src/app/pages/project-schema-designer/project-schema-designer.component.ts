import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ForgeApiService } from '../../services/forge-api.service';
import { DesignStateService } from '../../services/design-state.service';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { TableListPanelComponent } from './table-list-panel/table-list-panel.component';
import { TableEditorPanelComponent } from './table-editor-panel/table-editor-panel.component';
import { PreviewPanelComponent } from './preview-panel/preview-panel.component';
import { IssuesDrawerComponent } from './issues-drawer/issues-drawer.component';

@Component({
  selector: 'app-project-schema-designer',
  standalone: true,
  imports: [RouterLink, TableListPanelComponent, TableEditorPanelComponent, PreviewPanelComponent, IssuesDrawerComponent],
  templateUrl: './project-schema-designer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectSchemaDesignerComponent implements OnInit {
  readonly selectedTableId = signal<number | null>(null);
  readonly highlightedColumnId = signal<number | null>(null);
  readonly issuesDrawerOpen = signal(false);
  readonly generating = signal(false);
  readonly projectName = signal('');

  readonly design = this.designState.design;
  readonly loading = this.designState.loading;
  readonly conflict = this.designState.conflict;
  readonly error = this.designState.error;
  readonly hasDesign = computed(() => this.design() !== null);
  readonly tableCount = computed(() => this.design()?.tables.length ?? 0);
  readonly columnCount = computed(() => this.design()?.tables.reduce((total, table) => total + table.columns.length, 0) ?? 0);
  readonly relationshipCount = computed(() => this.design()?.relationships.length ?? 0);
  readonly issueCount = computed(() => this.design()?.validationIssues.length ?? 0);

  projectId = 0;

  constructor(
    private api: ForgeApiService,
    private designState: DesignStateService,
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

    this.api.getProject(this.projectId).subscribe({
      next: (project) => this.projectName.set(project.name),
    });

    this.designState.loadForProject(this.projectId).subscribe({
      next: (design) => this.autoSelectFirstTable(design?.tables.map((table) => table.id) ?? []),
    });
  }

  reload(): void {
    this.designState.reload().subscribe({
      next: (design) => this.autoSelectFirstTable(design?.tables.map((table) => table.id) ?? []),
    });
  }

  generateDesign(): void {
    this.generating.set(true);
    this.designState.generate('merge')
      .pipe(finalize(() => this.generating.set(false)))
      .subscribe({
        next: (design) => this.autoSelectFirstTable(design.tables.map((table) => table.id)),
      });
  }

  dismissError(): void {
    this.designState.dismissError();
  }

  onSelectTable(tableId: number): void {
    this.selectedTableId.set(tableId);
    this.highlightedColumnId.set(null);
  }

  onTableAdded(tableId: number): void {
    this.selectedTableId.set(tableId);
  }

  onTableDeleted(tableId: number): void {
    if (this.selectedTableId() === tableId) {
      const remaining = this.design()?.tables.map((table) => table.id) ?? [];
      this.selectedTableId.set(remaining[0] ?? null);
    }
  }

  onNavigateToIssue(target: { tableId?: number | null; columnId?: number | null; relationshipId?: number | null }): void {
    let tableId = target.tableId ?? null;

    if (tableId == null && target.relationshipId != null) {
      const relationship = this.designState.relationships().find((rel) => rel.id === target.relationshipId);
      tableId = relationship?.fromTableId ?? relationship?.toTableId ?? null;
    }

    if (tableId != null) {
      this.selectedTableId.set(tableId);
      this.highlightedColumnId.set(target.columnId ?? null);
    }
  }

  private autoSelectFirstTable(tableIds: number[]): void {
    if (this.selectedTableId() != null && tableIds.includes(this.selectedTableId()!)) {
      return;
    }

    this.selectedTableId.set(tableIds[0] ?? null);
  }
}
