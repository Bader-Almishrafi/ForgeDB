import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignModelResponse, DesignRelationship, RelationshipSuggestion } from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { ProjectRelationshipsComponent } from './project-relationships.component';

const baseDesign: DesignModelResponse = {
  id: 9, projectId: 10, revision: 5, status: 'Valid', isStale: false, canContinue: true,
  generatedAt: '', validatedAt: '2026-07-15T00:00:00Z', layout: null, createdAt: '', updatedAt: '', validationIssues: [],
  tables: [
    { id: 1, name: 'customers', sourceDatasetId: 101, origin: 'generated', columns: [
      { id: 11, name: 'customer_id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, sourceColumnName: 'customer_id', origin: 'generated' },
      { id: 12, name: 'name', sqlType: 'VARCHAR(120)', isNullable: false, isPrimaryKey: false, isUnique: false, ordinal: 1, sourceColumnName: 'name', origin: 'generated' },
    ] },
    { id: 2, name: 'orders', sourceDatasetId: 102, origin: 'generated', columns: [
      { id: 21, name: 'order_id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, sourceColumnName: 'order_id', origin: 'generated' },
      { id: 22, name: 'customer_id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: false, isUnique: false, ordinal: 1, sourceColumnName: 'customer_id', origin: 'generated' },
    ] },
    { id: 3, name: 'shipments', sourceDatasetId: 103, origin: 'generated', columns: [
      { id: 31, name: 'shipment_id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, sourceColumnName: 'shipment_id', origin: 'generated' },
      { id: 32, name: 'order_id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: false, isUnique: false, ordinal: 1, sourceColumnName: 'order_id', origin: 'generated' },
    ] },
  ],
  relationships: [],
};

const suggestions: RelationshipSuggestion[] = [
  {
    id: 71, projectId: 10, sourceDatasetId: 101, sourceTableName: 'customers', sourceColumnName: 'customer_id',
    targetDatasetId: 102, targetTableName: 'orders', targetColumnName: 'customer_id', score: 0.86,
    evidenceJson: '{"reasons":["Names match","Values overlap"]}', status: 'suggested', createdAt: '',
  },
  {
    id: 72, projectId: 10, sourceDatasetId: 103, sourceTableName: 'shipments', sourceColumnName: 'order_id',
    targetDatasetId: 102, targetTableName: 'orders', targetColumnName: 'order_id', score: 0.78,
    evidenceJson: '{"reasons":["Source references orders"]}', status: 'suggested', createdAt: '',
  },
];

function orderCustomerRelationship(id = 41): DesignRelationship {
  return {
    id, fromColumnId: 22, fromTableId: 2, fromTableName: 'orders', fromColumnName: 'customer_id',
    toColumnId: 11, toTableId: 1, toTableName: 'customers', toColumnName: 'customer_id',
    cardinality: 'many-to-one', onDelete: 'no-action', origin: 'accepted-suggestion', suggestionId: 71,
  };
}

describe('ProjectRelationshipsComponent', () => {
  let fixture: ComponentFixture<ProjectRelationshipsComponent>;
  let component: ProjectRelationshipsComponent;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let currentDesign: DesignModelResponse;
  let currentSuggestions: RelationshipSuggestion[];

  beforeEach(async () => {
    currentDesign = structuredClone(baseDesign);
    currentSuggestions = structuredClone(suggestions);
    api = {
      getSuggestions: vi.fn(() => of(structuredClone(currentSuggestions))),
      getDesign: vi.fn(() => of(structuredClone(currentDesign))),
      detectSuggestions: vi.fn(() => of(structuredClone(currentSuggestions))),
      acceptSuggestion: vi.fn((id: number, _revision: number, request: { fromColumnId: number; toColumnId: number; cardinality: string; onDelete: string }) => {
        const relationship: DesignRelationship = {
          ...orderCustomerRelationship(),
          fromColumnId: request.fromColumnId,
          toColumnId: request.toColumnId,
          cardinality: request.cardinality,
          onDelete: request.onDelete,
        };
        currentSuggestions = currentSuggestions.map(item => item.id === id ? { ...item, status: 'accepted' } : item);
        currentDesign = { ...currentDesign, revision: currentDesign.revision + 1, status: 'Draft', validatedAt: null, relationships: [relationship] };
        return of({ suggestion: currentSuggestions.find(item => item.id === id)!, relationship, designRevision: currentDesign.revision });
      }),
      rejectSuggestion: vi.fn((id: number) => {
        currentSuggestions = currentSuggestions.map(item => item.id === id ? { ...item, status: 'rejected' } : item);
        return of(currentSuggestions.find(item => item.id === id)!);
      }),
      createRelationship: vi.fn((_designId: number, _revision: number, request: { fromColumnId: number; toColumnId: number; cardinality: string; onDelete: string }) => {
        currentDesign = {
          ...currentDesign, revision: currentDesign.revision + 1, status: 'Draft', validatedAt: null,
          relationships: [...currentDesign.relationships, {
            id: 42, fromColumnId: request.fromColumnId, fromTableId: 3, fromTableName: 'shipments', fromColumnName: 'order_id',
            toColumnId: request.toColumnId, toTableId: 2, toTableName: 'orders', toColumnName: 'order_id',
            cardinality: request.cardinality, onDelete: request.onDelete, origin: 'user',
          }],
        };
        return of(structuredClone(currentDesign));
      }),
      updateRelationship: vi.fn((relationshipId: number, _revision: number, request: { cardinality: string; onDelete: string }) => {
        currentDesign = { ...currentDesign, revision: currentDesign.revision + 1, status: 'Draft', relationships: currentDesign.relationships.map(item => item.id === relationshipId ? { ...item, ...request } : item) };
        return of(structuredClone(currentDesign));
      }),
      deleteRelationship: vi.fn((relationshipId: number) => {
        currentDesign = { ...currentDesign, revision: currentDesign.revision + 1, status: 'Draft', relationships: currentDesign.relationships.filter(item => item.id !== relationshipId) };
        return of(structuredClone(currentDesign));
      }),
      validateSchema: vi.fn(() => {
        currentDesign = { ...currentDesign, revision: currentDesign.revision + 1, status: 'Valid', validatedAt: '2026-07-15T00:00:00Z' };
        return of(structuredClone(currentDesign));
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ProjectRelationshipsComponent],
      providers: [
        provideRouter([]),
        { provide: DesignApiService, useValue: api },
        { provide: WorkflowStateService, useValue: { setProjectId: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectId: '10' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectRelationshipsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('restores the complete workspace on direct route load with one design and suggestion request', () => {
    expect(component.projectId).toBe(10);
    expect(api['getDesign']).toHaveBeenCalledTimes(1);
    expect(api['getSuggestions']).toHaveBeenCalledTimes(1);
    expect(component.pendingSuggestions()).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('[data-testid="suggested-relationships"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="persisted-relationships"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="manual-relationship-form"]')).toBeTruthy();
    expect((fixture.nativeElement.querySelector('[data-testid="continue-to-er"]') as HTMLAnchorElement).getAttribute('href')).toBe('/projects/10/er-diagram');
  });

  it('reloads suggestions and the design after detection and clears the busy state', () => {
    component.detectRelationships();
    fixture.detectChanges();

    expect(api['detectSuggestions']).toHaveBeenCalledWith(10);
    expect(api['getDesign']).toHaveBeenCalledTimes(2);
    expect(api['getSuggestions']).toHaveBeenCalledTimes(2);
    expect(component.busyAction()).toBeNull();
    expect(component.feedback()?.title).toBe('Detection complete');
  });

  it('accepts edited source, target, cardinality, and On Delete atomically then refreshes the workspace', () => {
    const suggestion = component.pendingSuggestions()[0];
    component.startSuggestionEdit(suggestion);
    component.updateSuggestionDraft({ fromTableId: 2 });
    component.updateSuggestionDraft({ fromColumnId: 22 });
    component.updateSuggestionDraft({ toTableId: 1 });
    component.updateSuggestionDraft({ toColumnId: 11, cardinality: 'one-to-one', onDelete: 'cascade' });

    component.acceptEditedSuggestion(suggestion);
    fixture.detectChanges();

    expect(api['acceptSuggestion']).toHaveBeenCalledWith(71, 5, {
      fromColumnId: 22, toColumnId: 11, cardinality: 'one-to-one', onDelete: 'cascade',
    });
    expect(component.pendingSuggestions().map(item => item.id)).toEqual([72]);
    expect(component.persistedRelationships()).toHaveLength(1);
    expect(component.persistedRelationships()[0].onDelete).toBe('cascade');
    expect(component.editingSuggestionId()).toBeNull();
    expect(component.busyAction()).toBeNull();
  });

  it('rejects a suggestion, removes it from pending, and does not create a relationship', () => {
    component.rejectSuggestion(component.pendingSuggestions()[1]);
    fixture.detectChanges();

    expect(component.pendingSuggestions().map(item => item.id)).toEqual([71]);
    expect(component.rejectedSuggestionCount()).toBe(1);
    expect(component.persistedRelationships()).toHaveLength(0);
    expect(component.busyAction()).toBeNull();
  });

  it('validates manual project endpoints, key targets, types, and duplicates', () => {
    expect(component.manualValidationMessage()).toContain('Select source and target');
    component.updateManualDraft({ fromTableId: 1 });
    component.updateManualDraft({ fromColumnId: 11 });
    component.updateManualDraft({ toTableId: 1 });
    component.updateManualDraft({ toColumnId: 11 });
    expect(component.manualValidationMessage()).toContain('exact same endpoint');
    component.updateManualDraft({ fromTableId: 2 });
    component.updateManualDraft({ fromColumnId: 22 });
    component.updateManualDraft({ toTableId: 1 });
    component.updateManualDraft({ toColumnId: 12 });
    expect(component.manualValidationMessage()).toContain('Primary Key or Unique');
    currentDesign.relationships = [orderCustomerRelationship()];
    component.design.set(structuredClone(currentDesign));
    component.updateManualDraft({ toColumnId: 11 });
    expect(component.manualValidationMessage()).toContain('already exists');
  });

  it('creates a manual relationship and reloads the persisted list without stale local state', () => {
    component.updateManualDraft({ fromTableId: 3 });
    component.updateManualDraft({ fromColumnId: 32 });
    component.updateManualDraft({ toTableId: 2 });
    component.updateManualDraft({ toColumnId: 21 });
    component.createManualRelationship();
    fixture.detectChanges();

    expect(api['createRelationship']).toHaveBeenCalledWith(9, 5, { fromColumnId: 32, toColumnId: 21, cardinality: 'many-to-one', onDelete: 'no-action' });
    expect(component.persistedRelationships()).toHaveLength(1);
    expect(component.manualDraft().fromTableId).toBeNull();
    expect(component.feedback()?.title).toBe('Relationship created');
  });

  it('edits a persisted relationship and displays the refreshed revision immediately', () => {
    currentDesign.relationships = [orderCustomerRelationship()];
    component.reloadWorkspace();
    const relationship = component.persistedRelationships()[0];
    component.startRelationshipEdit(relationship);
    component.updateRelationshipDraft({ onDelete: 'cascade' });
    component.saveRelationshipEdit(relationship);
    fixture.detectChanges();

    expect(api['updateRelationship']).toHaveBeenCalledWith(41, 5, { cardinality: 'many-to-one', onDelete: 'cascade' });
    expect(component.persistedRelationships()[0].onDelete).toBe('cascade');
    expect(component.design()?.revision).toBe(6);
    expect(component.editingRelationshipId()).toBeNull();
  });

  it('requires confirmation before delete and removes the relationship after a refreshed response', () => {
    currentDesign.relationships = [orderCustomerRelationship()];
    component.reloadWorkspace();
    const relationship = component.persistedRelationships()[0];
    component.requestDelete(relationship);
    fixture.detectChanges();
    expect(api['deleteRelationship']).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();

    component.confirmDelete();
    fixture.detectChanges();
    expect(api['deleteRelationship']).toHaveBeenCalledWith(41, 5);
    expect(component.persistedRelationships()).toHaveLength(0);
    expect(component.deleteTarget()).toBeNull();
  });

  it('reloads current server state after a failed mutation and always clears loading state', () => {
    api['rejectSuggestion'].mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Suggestion changed elsewhere.' } })));
    component.rejectSuggestion(component.pendingSuggestions()[0]);
    fixture.detectChanges();

    expect(api['getDesign']).toHaveBeenCalledTimes(2);
    expect(api['getSuggestions']).toHaveBeenCalledTimes(2);
    expect(component.busyAction()).toBeNull();
    expect(component.feedback()?.kind).toBe('error');
    expect(component.feedback()?.message).toContain('changed elsewhere');
  });

  it('revalidates Draft relationship changes without trapping the ER workflow', () => {
    component.design.set({ ...currentDesign, status: 'Draft', validatedAt: null });
    component.validateDesign();
    fixture.detectChanges();

    expect(api['validateSchema']).toHaveBeenCalledWith(10, 5);
    expect(component.design()?.status).toBe('Valid');
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="continue-to-er"]').length).toBeGreaterThan(0);
  });

  it('keeps every workflow section contained at the 390px responsive layout', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();

    const page = fixture.nativeElement.querySelector('[data-testid="relationships-page"]') as HTMLElement;
    expect(page.classList.contains('overflow-x-hidden')).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="manual-source-table"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="continue-to-er-bottom"]')).toBeTruthy();
  });
});
