import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import { ApiErrorBody, ProjectRelationshipSuggestion, ProjectSchema } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { DesignApiService } from '../../services/design-api.service';
import { mapDesignToProjectSchema } from '../../services/design-view-model';
import { WorkflowStateService } from '../../services/workflow-state.service';

interface NodeTheme {
  bodyGradient: string;
  glow: string;
  lineStroke: string;
  colorName: 'indigo' | 'purple' | 'cyan';
}

interface DiagramNode {
  name: string;
  columns: { name: string; type: string; primaryKey: boolean; foreignKey: boolean }[];
  hiddenColumnCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  theme: NodeTheme;
}

interface DiagramConnection {
  id: string;
  path: string;
  label: string;
  labelX: number;
  labelY: number;
  strokeColor: string;
  markerStart: string;
  markerEnd: string;
}

interface Diagram {
  width: number;
  height: number;
  nodes: DiagramNode[];
  connections: DiagramConnection[];
}

const NODE_THEMES: NodeTheme[] = [
  { bodyGradient: 'from-indigo-950/80 to-[#0e1629]/95', glow: 'rgba(99,102,241,0.25)', lineStroke: '#6366f1', colorName: 'indigo' },
  { bodyGradient: 'from-purple-950/80 to-[#0e1629]/95', glow: 'rgba(168,85,247,0.25)', lineStroke: '#a855f7', colorName: 'purple' },
  { bodyGradient: 'from-cyan-950/80 to-[#0e1629]/95', glow: 'rgba(14,165,233,0.25)', lineStroke: '#0ea5e9', colorName: 'cyan' },
];

@Component({
  selector: 'app-project-er-diagram',
  standalone: true,
  imports: [NgClass, RouterLink],
  templateUrl: './project-er-diagram.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectErDiagramComponent implements OnInit {
  @ViewChild('diagramViewport') private diagramViewport?: ElementRef<HTMLDivElement>;

  readonly schema = signal<ProjectSchema | null>(null);
  readonly diagram = signal<Diagram | null>(null);
  readonly loading = signal(false);
  readonly selectedNode = signal<DiagramNode | null>(null);
  readonly zoom = signal(100);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly panning = signal(false);

  private activePointerId: number | null = null;
  private pointerStart = { x: 0, y: 0, panX: 0, panY: 0 };
  private pointerMoved = false;
  private suppressNextClick = false;

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
          const schema = design ? mapDesignToProjectSchema(design, this.projectId, project.name) : null;
          this.schema.set(schema);
          this.selectedNode.set(null);
          this.diagram.set(schema ? this.createDiagram(schema) : null);
          this.resetView();
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load ER diagram.';
        },
      });
  }

  relationshipLabel(relationship: ProjectRelationshipSuggestion): string {
    return `${relationship.fromTable}.${relationship.fromColumn} → ${relationship.toTable}.${relationship.toColumn}`;
  }

  selectNode(node: DiagramNode | null): void {
    this.selectedNode.set(node);
  }

  zoomIn(): void {
    this.zoom.update((value) => Math.min(160, value + 10));
    this.clampCurrentPan();
  }

  zoomOut(): void {
    this.zoom.update((value) => Math.max(40, value - 10));
    this.clampCurrentPan();
  }

  resetZoom(): void {
    this.resetView();
  }

  resetView(): void {
    this.zoom.set(100);
    this.panX.set(0);
    this.panY.set(0);
  }

  diagramTransform(): string {
    return `translate3d(${this.panX()}px, ${this.panY()}px, 0) scale(${this.zoom() / 100})`;
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.activePointerId !== null) return;
    this.activePointerId = event.pointerId;
    this.pointerStart = { x: event.clientX, y: event.clientY, panX: this.panX(), panY: this.panY() };
    this.pointerMoved = false;
    this.panning.set(true);
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* jsdom/legacy browser */ }
    event.preventDefault();
  }

  onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) return;
    const deltaX = event.clientX - this.pointerStart.x;
    const deltaY = event.clientY - this.pointerStart.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) >= 3) this.pointerMoved = true;
    this.setPan(this.pointerStart.panX + deltaX, this.pointerStart.panY + deltaY);
    event.preventDefault();
  }

  onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) return;
    this.suppressNextClick = this.pointerMoved;
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId); } catch { /* jsdom/legacy browser */ }
    this.activePointerId = null;
    this.panning.set(false);
  }

  onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    this.pointerMoved = false;
    this.panning.set(false);
  }

  onCanvasClick(): void {
    if (this.consumeSuppressedClick()) return;
    this.selectNode(null);
  }

  selectNodeFromPointer(event: MouseEvent, node: DiagramNode): void {
    event.stopPropagation();
    if (this.consumeSuppressedClick()) return;
    this.selectNode(node);
  }

  private consumeSuppressedClick(): boolean {
    if (!this.suppressNextClick) return false;
    this.suppressNextClick = false;
    return true;
  }

  private clampCurrentPan(): void {
    this.setPan(this.panX(), this.panY());
  }

  private setPan(x: number, y: number): void {
    const chart = this.diagram();
    const viewport = this.diagramViewport?.nativeElement;
    if (!chart || !viewport) {
      this.panX.set(Math.min(0, x));
      this.panY.set(Math.min(0, y));
      return;
    }

    const scale = this.zoom() / 100;
    const minX = Math.min(0, viewport.clientWidth - chart.width * scale);
    const minY = Math.min(0, viewport.clientHeight - chart.height * scale);
    this.panX.set(Math.max(minX, Math.min(0, x)));
    this.panY.set(Math.max(minY, Math.min(0, y)));
  }

  private createDiagram(schema: ProjectSchema): Diagram {
    if (!schema.tables.length) {
      return { width: 720, height: 560, nodes: [], connections: [] };
    }

    const nodeWidth = 240;
    const rowGap = 64;

    const fkMap = new Set<string>();
    schema.relationships.forEach((relationship) => fkMap.add(`${relationship.fromTable}.${relationship.fromColumn}`));

    const nodes = schema.tables.map((table, index): DiagramNode => {
      const displayedColumns = table.columns.slice(0, 12).map((column) => ({
        name: column.name,
        type: column.sqlType || column.detectedDataType || 'TEXT',
        primaryKey: column.isPrimaryKeyCandidate,
        foreignKey: fkMap.has(`${table.tableName}.${column.name}`),
      }));
      return {
        name: table.tableName,
        columns: displayedColumns,
        hiddenColumnCount: Math.max(table.columns.length - displayedColumns.length, 0),
        x: 0,
        y: 0,
        width: nodeWidth,
        height: 52 + displayedColumns.length * 24 + (table.columns.length > displayedColumns.length ? 24 : 0),
        theme: NODE_THEMES[index % NODE_THEMES.length],
      };
    });

    const nodesByName = new Map(nodes.map((node) => [node.name, node]));
    const relationshipCount = new Map<string, number>();
    schema.relationships.forEach((relationship) => {
      relationshipCount.set(relationship.fromTable, (relationshipCount.get(relationship.fromTable) ?? 0) + 1);
      relationshipCount.set(relationship.toTable, (relationshipCount.get(relationship.toTable) ?? 0) + 1);
    });
    const hub = nodes.reduce((best, node) => (relationshipCount.get(node.name) ?? 0) > (relationshipCount.get(best.name) ?? 0) ? node : best, nodes[0]);
    const outgoing = nodes.filter((node) => node !== hub && schema.relationships.some((relationship) => relationship.fromTable === hub.name && relationship.toTable === node.name));
    const incoming = nodes.filter((node) => node !== hub && !outgoing.includes(node) && schema.relationships.some((relationship) => relationship.fromTable === node.name && relationship.toTable === hub.name));
    const peripheral = nodes.filter((node) => node !== hub && !incoming.includes(node) && !outgoing.includes(node));
    const stackHeight = (items: DiagramNode[]) => items.reduce((total, node) => total + node.height, 0) + Math.max(items.length - 1, 0) * rowGap;
    const diagramHeight = Math.max(720, stackHeight(incoming) + 64, stackHeight(outgoing) + 64, stackHeight(peripheral) + hub.height + 180);
    const hubX = 510;
    const centerY = diagramHeight / 2;
    hub.x = hubX;
    hub.y = centerY - hub.height / 2;

    const placeStack = (items: DiagramNode[], x: number, verticalCenter: number): void => {
      let y = verticalCenter - stackHeight(items) / 2;
      items.forEach((node) => {
        node.x = x;
        node.y = y;
        y += node.height + rowGap;
      });
    };
    placeStack(incoming, 48, centerY);
    placeStack(outgoing, hubX + nodeWidth + 250, centerY);
    placeStack(peripheral, hubX, hub.y + hub.height + 120 + stackHeight(peripheral) / 2);
    const diagramWidth = Math.max(1180, hubX + nodeWidth * 2 + 300);

    const sourcePorts = new Map<string, number>();
    const targetPorts = new Map<string, number>();
    const connections = schema.relationships.flatMap((relationship, index): DiagramConnection[] => {
      const source = nodesByName.get(relationship.fromTable);
      const target = nodesByName.get(relationship.toTable);
      if (!source || !target) return [];

      const sourceOnLeft = source.x <= target.x;
      const startX = sourceOnLeft ? source.x + source.width : source.x;
      const endX = sourceOnLeft ? target.x : target.x + target.width;
      const sourcePort = sourcePorts.get(source.name) ?? 0;
      const targetPort = targetPorts.get(target.name) ?? 0;
      sourcePorts.set(source.name, sourcePort + 1);
      targetPorts.set(target.name, targetPort + 1);
      const startY = source.y + Math.min(source.height - 20, 55 + sourcePort * 20);
      const endY = target.y + Math.min(target.height - 20, 55 + targetPort * 20);
      const controlX = (startX + endX) / 2;

      const colorName = source.theme.colorName;
      const relType = (relationship.relationshipType || '').toLowerCase().trim();
      let markerStart = `url(#dot-${colorName})`;
      let markerEnd = `url(#arrow-${colorName})`;

      if (relType === 'many-to-one') {
        markerStart = `url(#many-${colorName})`;
        markerEnd = `url(#one-${colorName})`;
      } else if (relType === 'one-to-many') {
        markerStart = `url(#one-${colorName})`;
        markerEnd = `url(#many-${colorName})`;
      } else if (relType === 'one-to-one') {
        markerStart = `url(#one-${colorName})`;
        markerEnd = `url(#one-${colorName})`;
      }

      return [{
        id: relationship.suggestionId || `${relationship.fromTable}-${relationship.toTable}-${index}`,
        path: `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`,
        label: relType.replace(/-/g, ' ') || 'related',
        labelX: controlX,
        labelY: (startY + endY) / 2 - 8,
        strokeColor: source.theme.lineStroke,
        markerStart,
        markerEnd,
      }];
    });

    return { width: diagramWidth, height: diagramHeight, nodes, connections };
  }
}
