import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, SchemaRelationship, SchemaResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-relationships',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './relationships.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelationshipsComponent implements OnInit {
  readonly schema = signal<SchemaResponse | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);

  schemaId = 0;
  errorMessage = '';
  successMessage = '';
  relationship: SchemaRelationship = this.emptyRelationship();

  constructor(
    private api: ForgeApiService,
    private route: ActivatedRoute,
    private router: Router,
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
          this.relationship = this.emptyRelationship(schema.generatedTableName);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load schema relationships.';
        },
      });
  }

  saveRelationship(): void {
    const currentSchema = this.schema();
    if (!currentSchema) {
      this.errorMessage = 'Load a schema before saving relationships.';
      return;
    }

    const relationships = [
      ...currentSchema.relationships,
      {
        ...this.relationship,
        name: this.relationship.name || null,
        relationshipType: this.relationship.relationshipType || null,
      },
    ];

    this.updateRelationships(relationships, 'Relationship saved.');
  }

  removeRelationship(index: number): void {
    const currentSchema = this.schema();
    if (!currentSchema) {
      return;
    }

    this.updateRelationships(
      currentSchema.relationships.filter((_, relationshipIndex) => relationshipIndex !== index),
      'Relationship removed.',
    );
  }

  relationshipPreview(): string {
    const relationship = this.relationship;
    const from = `${relationship.fromTable || 'from_table'}.${relationship.fromColumn || 'from_column'}`;
    const to = `${relationship.toTable || 'to_table'}.${relationship.toColumn || 'to_column'}`;

    return `${from} -> ${to}`;
  }

  private updateRelationships(relationships: SchemaRelationship[], message: string): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.saving.set(true);

    this.api.updateRelationships(this.schemaId, { relationships })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (schema) => {
          this.schema.set(schema);
          this.workflow.setSchema(schema);
          this.relationship = this.emptyRelationship(schema.generatedTableName);
          this.successMessage = message;
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to save relationships.';
        },
      });
  }

  private emptyRelationship(defaultTable = ''): SchemaRelationship {
    return {
      name: '',
      fromTable: defaultTable,
      fromColumn: '',
      toTable: '',
      toColumn: '',
      relationshipType: 'many-to-one',
    };
  }
}
