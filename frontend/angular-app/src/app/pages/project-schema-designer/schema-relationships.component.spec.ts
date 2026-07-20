import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignModelResponse, DesignRelationship, RelationshipSuggestion } from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';
import { SchemaRelationshipsComponent } from './schema-relationships.component';

const makeDesign = (): DesignModelResponse => ({
  id: 8, projectId: 10, revision: 2, status: 'Valid', isStale: false, canContinue: true,
  layout: null, createdAt: '', updatedAt: '', validationIssues: [], relationships: [],
  tables: [
    { id: 1, name: 'customers', sourceDatasetId: 1, sourceDatasetVersionId: 11, origin: 'generated', columns: [
      { id: 11, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, sourceColumnName: 'id', origin: 'generated' },
    ] },
    { id: 2, name: 'orders', sourceDatasetId: 2, sourceDatasetVersionId: 12, origin: 'generated', columns: [
      { id: 21, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, sourceColumnName: 'id', origin: 'generated' },
      { id: 22, name: 'customer_id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: false, isUnique: false, ordinal: 1, sourceColumnName: 'customer_id', origin: 'generated' },
    ] },
  ],
});

const suggestion = (): RelationshipSuggestion => ({
  id: 50, projectId: 10, sourceDatasetId: 2, sourceTableName: 'orders', sourceColumnName: 'customer_id',
  targetDatasetId: 1, targetTableName: 'customers', targetColumnName: 'id', score: .92,
  evidenceJson: JSON.stringify({ reasons: ['Names and values match.'] }), status: 'suggested', createdAt: '',
});

const relationship = (): DesignRelationship => ({
  id: 70, fromColumnId: 22, fromTableId: 2, fromTableName: 'orders', fromColumnName: 'customer_id',
  toColumnId: 11, toTableId: 1, toTableName: 'customers', toColumnName: 'id',
  cardinality: 'many-to-one', onDelete: 'no-action', origin: 'user',
});

describe('SchemaRelationshipsComponent', () => {
  let fixture: ComponentFixture<SchemaRelationshipsComponent>;
  let component: SchemaRelationshipsComponent;
  let currentDesign: DesignModelResponse;
  let currentSuggestions: RelationshipSuggestion[];
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    currentDesign = makeDesign();
    currentSuggestions = [suggestion()];
    const reload = () => of(structuredClone(currentDesign));
    api = {
      getSchema: vi.fn(reload),
      getSuggestions: vi.fn(() => of(structuredClone(currentSuggestions))),
      detectSuggestions: vi.fn(() => of(structuredClone(currentSuggestions))),
      acceptSuggestion: vi.fn((_id: number, _revision: number, request: { fromColumnId: number; toColumnId: number; cardinality: string; onDelete: string }) => {
        const saved = { ...relationship(), fromColumnId: request.fromColumnId, toColumnId: request.toColumnId, cardinality: request.cardinality, onDelete: request.onDelete, origin: 'suggestion', suggestionId: 50 };
        currentDesign = { ...currentDesign, revision: currentDesign.revision + 1, status: 'Draft', relationships: [saved] };
        currentSuggestions = currentSuggestions.map((item) => ({ ...item, status: 'accepted' }));
        return of({ suggestion: currentSuggestions[0], relationship: saved, designRevision: currentDesign.revision });
      }),
      rejectSuggestion: vi.fn(() => {
        currentSuggestions = currentSuggestions.map((item) => ({ ...item, status: 'rejected' }));
        return of(currentSuggestions[0]);
      }),
      createRelationship: vi.fn((_designId: number, _revision: number, request: { fromColumnId: number; toColumnId: number; cardinality: string; onDelete: string }) => {
        currentDesign = { ...currentDesign, revision: currentDesign.revision + 1, status: 'Draft', relationships: [{ ...relationship(), ...request }] };
        return reload();
      }),
      updateRelationship: vi.fn((_id: number, _revision: number, request: { cardinality: string; onDelete: string }) => {
        currentDesign = { ...currentDesign, revision: currentDesign.revision + 1, status: 'Draft', relationships: currentDesign.relationships.map((item) => ({ ...item, ...request })) };
        return reload();
      }),
      deleteRelationship: vi.fn(() => {
        currentDesign = { ...currentDesign, revision: currentDesign.revision + 1, status: 'Draft', relationships: [] };
        return reload();
      }),
      isRevisionConflict: vi.fn((error: { status?: number }) => error?.status === 409),
    };
    await TestBed.configureTestingModule({
      imports: [SchemaRelationshipsComponent],
      providers: [{ provide: DesignApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(SchemaRelationshipsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('projectId', 10);
    fixture.componentRef.setInput('design', currentDesign);
    fixture.componentRef.setInput('disabled', false);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('detects and reloads relationship suggestions', () => {
    component.detectRelationships();
    expect(api['detectSuggestions']).toHaveBeenCalledWith(10);
    expect(api['getSuggestions']).toHaveBeenCalledTimes(2);
    expect(component.pendingSuggestions()).toHaveLength(1);
  });

  it('does not start relationship mutations while the workflow or schema is blocked', () => {
    fixture.componentRef.setInput('disabled', true);
    component.detectRelationships();
    expect(api['detectSuggestions']).not.toHaveBeenCalled();
  });

  it('accepts a suggestion with the current schema revision and emits the refreshed Draft schema', () => {
    let changed: DesignModelResponse | undefined;
    component.designChanged.subscribe((value) => changed = value);
    component.acceptSuggestion(component.pendingSuggestions()[0]);
    expect(api['acceptSuggestion']).toHaveBeenCalledWith(50, 2, expect.objectContaining({ fromColumnId: 22, toColumnId: 11 }));
    expect(changed?.revision).toBe(3);
    expect(changed?.status).toBe('Draft');
    expect(component.pendingSuggestions()).toHaveLength(0);
  });

  it('edits a suggestion before accepting it', () => {
    const item = component.pendingSuggestions()[0];
    component.startSuggestionEdit(item);
    component.updateSuggestionDraft({ cardinality: 'one-to-one', onDelete: 'cascade' });
    component.acceptEditedSuggestion(item);
    expect(api['acceptSuggestion']).toHaveBeenCalledWith(50, 2, expect.objectContaining({ cardinality: 'one-to-one', onDelete: 'cascade' }));
  });

  it('rejects a suggestion without creating a persisted relationship', () => {
    component.rejectSuggestion(component.pendingSuggestions()[0]);
    expect(api['rejectSuggestion']).toHaveBeenCalledWith(50);
    expect(component.pendingSuggestions()).toHaveLength(0);
    expect(currentDesign.relationships).toHaveLength(0);
  });

  it('creates a manual relationship and prevents an exact duplicate locally', () => {
    component.updateManualDraft({ fromTableId: 2 });
    component.updateManualDraft({ fromColumnId: 22 });
    component.updateManualDraft({ toTableId: 1 });
    component.updateManualDraft({ toColumnId: 11 });
    component.createManualRelationship();
    expect(api['createRelationship']).toHaveBeenCalledWith(8, 2, expect.objectContaining({ fromColumnId: 22, toColumnId: 11 }));

    fixture.componentRef.setInput('design', currentDesign);
    component.updateManualDraft({ fromTableId: 2 });
    component.updateManualDraft({ fromColumnId: 22 });
    component.updateManualDraft({ toTableId: 1 });
    component.updateManualDraft({ toColumnId: 11 });
    expect(component.manualValidationMessage()).toContain('already exists');
  });

  it('edits persisted cardinality and delete behavior', () => {
    currentDesign = { ...currentDesign, relationships: [relationship()] };
    fixture.componentRef.setInput('design', currentDesign);
    const item = currentDesign.relationships[0];
    component.startRelationshipEdit(item);
    component.updateRelationshipDraft({ cardinality: 'one-to-one', onDelete: 'cascade' });
    component.saveRelationshipEdit(item);
    expect(api['updateRelationship']).toHaveBeenCalledWith(70, 2, { cardinality: 'one-to-one', onDelete: 'cascade' });
    expect(currentDesign.status).toBe('Draft');
  });

  it('requires confirmation before deleting a persisted relationship', () => {
    currentDesign = { ...currentDesign, relationships: [relationship()] };
    fixture.componentRef.setInput('design', currentDesign);
    component.requestDelete(currentDesign.relationships[0]);
    expect(component.deleteTarget()?.id).toBe(70);
    component.confirmDelete();
    expect(api['deleteRelationship']).toHaveBeenCalledWith(70, 2);
    expect(currentDesign.relationships).toHaveLength(0);
  });

  it('surfaces a relationship revision conflict without overwriting the current input', () => {
    currentDesign = { ...currentDesign, relationships: [relationship()] };
    fixture.componentRef.setInput('design', currentDesign);
    api['updateRelationship'].mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })));
    let conflicted = false;
    component.revisionConflict.subscribe(() => conflicted = true);
    component.startRelationshipEdit(currentDesign.relationships[0]);
    component.saveRelationshipEdit(currentDesign.relationships[0]);
    expect(conflicted).toBe(true);
    expect(component.feedback()?.title).toBe('Schema changed elsewhere');
    expect(api['getSchema']).not.toHaveBeenCalled();
  });

  it('renders suggestions, persisted relationships, and manual creation without a diagram', () => {
    currentDesign = { ...currentDesign, relationships: [relationship()] };
    fixture.componentRef.setInput('design', currentDesign);
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('[data-testid="relationship-suggestions"]')).toBeTruthy();
    expect(page.querySelector('[data-testid="persisted-relationships"]')).toBeTruthy();
    expect(page.querySelector('[data-testid="manual-relationship-form"]')).toBeTruthy();
    expect(page.textContent).not.toContain('ER Diagram');
  });
});
