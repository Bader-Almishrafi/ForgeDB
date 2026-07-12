import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectRelationshipSuggestion, ProjectSchema } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

interface DiagramNode {
	name: string;
	columns: { name: string; type: string; primaryKey: boolean }[];
	hiddenColumnCount: number;
	x: number;
	y: number;
	width: number;
	height: number;
	headerColor: string;
}

interface DiagramConnection {
	id: string;
	path: string;
	label: string;
	labelX: number;
	labelY: number;
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
	imports: [RouterLink],
	templateUrl: './project-er-diagram.component.html',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectErDiagramComponent implements OnInit {
	readonly schema = signal<ProjectSchema | null>(null);
	readonly diagram = signal<Diagram | null>(null);
	readonly loading = signal(false);
	readonly undoingId = signal<string | null>(null);

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

		const nodeWidth = 300;
		const rowGap = 64;
		const headerColors = ['#e0e7ff', '#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3'];
		const nodes = schema.tables.map((table, index): DiagramNode => {
			const displayedColumns = table.columns.slice(0, 12).map((column) => ({
				name: column.name,
				type: column.sqlType || column.detectedDataType || 'TEXT',
				primaryKey: column.isPrimaryKeyCandidate,
			}));
			return {
				name: table.tableName,
				columns: displayedColumns,
				hiddenColumnCount: Math.max(table.columns.length - displayedColumns.length, 0),
				x: 0,
				y: 0,
				width: nodeWidth,
				height: 62 + displayedColumns.length * 22 + (table.columns.length > displayedColumns.length ? 22 : 0),
				headerColor: headerColors[index % headerColors.length],
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
			const startY = source.y + Math.min(source.height - 18, 55 + sourcePort * 16);
			const endY = target.y + Math.min(target.height - 18, 55 + targetPort * 16);
			const controlX = (startX + endX) / 2 + ((index % 3) - 1) * 18;
			return [{
				id: relationship.suggestionId || `${relationship.fromTable}-${relationship.toTable}-${index}`,
				path: `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`,
				label: relationship.relationshipType || 'RELATED',
				labelX: controlX,
				labelY: (startY + endY) / 2 - 8,
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
		return `${relationship.fromTable} (${relationship.fromColumn}) → ${relationship.toTable} (${relationship.toColumn})`;
	}
}
