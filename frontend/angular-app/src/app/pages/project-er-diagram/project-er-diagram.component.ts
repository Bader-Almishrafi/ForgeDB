import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectRelationshipSuggestion, ProjectSchema } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

interface NodeColorInfo {
	headerBg: string;
	bodyGradient: string;
	glow: string;
	lineStroke: string;
}

interface DiagramNode {
	name: string;
	columns: { name: string; type: string; primaryKey: boolean; foreignKey: boolean }[];
	hiddenColumnCount: number;
	x: number;
	y: number;
	width: number;
	height: number;
	theme: NodeColorInfo;
}

interface DiagramConnection {
	id: string;
	path: string;
	label: string;
	labelX: number;
	labelY: number;
	strokeColor: string;
	startX: number;
	startY: number;
	endX: number;
	endY: number;
	markerStart: string;
	markerEnd: string;
}

interface Diagram {
	width: number;
	height: number;
	nodes: DiagramNode[];
	connections: DiagramConnection[];
}

@Component({
	selector: 'app-project-er-diagram',
	standalone: true,
	imports: [CommonModule],
	templateUrl: './project-er-diagram.component.html',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectErDiagramComponent implements OnInit {
	readonly schema = signal<ProjectSchema | null>(null);
	readonly diagram = signal<Diagram | null>(null);
	readonly loading = signal(false);
	readonly undoingId = signal<string | null>(null);
	readonly selectedNode = signal<DiagramNode | null>(null);

	projectId = 0;
	errorMessage = '';
	successMessage = '';

	constructor(
		private api: ForgeApiService,
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
		this.api.getProjectSchema(this.projectId)
			.pipe(finalize(() => this.loading.set(false)))
			.subscribe({
				next: (schema) => {
					this.schema.set(schema);
					this.diagram.set(this.createDiagram(schema));
				},
				error: (error: { error?: ApiErrorBody }) => {
					this.errorMessage = error.error?.message ?? 'Unable to load ER diagram.';
				},
			});
	}

	private createDiagram(schema: ProjectSchema): Diagram {
		if (!schema.tables.length) {
			return { width: 720, height: 560, nodes: [], connections: [] };
		}

		const nodeWidth = 240;
		const rowGap = 64;
		const colorThemes: NodeColorInfo[] = [
			{ headerBg: '#118bfb', bodyGradient: 'from-[#0d2a55]/80 to-[#0e1629]/95', glow: 'rgba(17,139,251,0.2)', lineStroke: '#118bfb' }, // Blue
			{ headerBg: '#842df5', bodyGradient: 'from-[#2e0e5a]/80 to-[#0e1629]/95', glow: 'rgba(132,45,245,0.2)', lineStroke: '#842df5' }, // Purple
			{ headerBg: '#2eaaf9', bodyGradient: 'from-[#0d3455]/80 to-[#0e1629]/95', glow: 'rgba(46,170,249,0.2)', lineStroke: '#2eaaf9' }, // Cyan
		];

		const fkMap = new Set<string>();
		schema.relationships.forEach(r => fkMap.add(`${r.fromTable}.${r.fromColumn}`));

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
				theme: colorThemes[index % colorThemes.length],
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
		const connections = schema.relationships.flatMap((relationship, index) => {
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

			const colorName = source.theme.lineStroke === '#118bfb' ? 'blue' : source.theme.lineStroke === '#842df5' ? 'purple' : 'cyan';
			const relType = (relationship.relationshipType || '').toUpperCase().trim().replace(/-/g, '_');
			let markerStart = `url(#dot-${colorName})`;
			let markerEnd = `url(#arrow-${colorName})`;

			if (relType === '1:N' || relType === 'ONE_TO_MANY') {
				markerStart = `url(#one-${colorName})`;
				markerEnd = `url(#many-${colorName})`;
			} else if (relType === 'N:1' || relType === 'MANY_TO_ONE') {
				markerStart = `url(#many-${colorName})`;
				markerEnd = `url(#one-${colorName})`;
			} else if (relType === '1:1' || relType === 'ONE_TO_ONE') {
				markerStart = `url(#one-${colorName})`;
				markerEnd = `url(#one-${colorName})`;
			}

			return [{
				id: relationship.suggestionId || `${relationship.fromTable}-${relationship.toTable}-${index}`,
				path: `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`,
				label: relationship.relationshipType || 'RELATED',
				labelX: controlX,
				labelY: (startY + endY) / 2 - 8,
				strokeColor: source.theme.lineStroke,
				startX, startY, endX, endY,
				markerStart, markerEnd
			}];
		});

		return {
			width: diagramWidth,
			height: diagramHeight,
			nodes,
			connections,
		};
	}

	undoRelationship(relationship: ProjectRelationshipSuggestion): void {
		this.errorMessage = '';
		this.successMessage = '';
		this.undoingId.set(relationship.suggestionId);
		this.api.rejectProjectRelationship(this.projectId, relationship)
			.pipe(finalize(() => this.undoingId.set(null)))
			.subscribe({
				next: () => {
					this.successMessage = 'Relationship undone successfully.';
					this.loadSchema();
				},
				error: (error: { error?: ApiErrorBody }) => {
					this.errorMessage = error.error?.message ?? 'Unable to undo relationship.';
				},
			});
	}

	relationshipLabel(relationship: ProjectRelationshipSuggestion): string {
		return `${relationship.fromTable}.${relationship.fromColumn} → ${relationship.toTable}.${relationship.toColumn}`;
	}

	selectNode(node: DiagramNode | null): void {
		this.selectedNode.set(node);
	}
}
