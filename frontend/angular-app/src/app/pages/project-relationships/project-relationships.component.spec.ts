import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignModelResponse, RelationshipSuggestion } from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';
import { DesignStateService } from '../../services/design-state.service';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { ProjectRelationshipsComponent } from './project-relationships.component';

const schema: DesignModelResponse = {
  id: 9, projectId: 10, revision: 5, status: 'Valid', isStale: false, canContinue: true,
  generatedAt: '', validatedAt: '', layout: null, createdAt: '', updatedAt: '', validationIssues: [],
  tables: [
    { id: 1, name: 'customers', sourceDatasetId: 101, origin: 'generated', columns: [
      { id: 11, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, sourceColumnName: 'id', origin: 'generated' },
      { id: 12, name: 'external_id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: false, isUnique: true, ordinal: 1, sourceColumnName: 'external_id', origin: 'generated' },
      { id: 13, name: 'name', sqlType: 'TEXT', isNullable: true, isPrimaryKey: false, isUnique: false, ordinal: 2, sourceColumnName: 'name', origin: 'generated' },
      { id: 14, name: 'uuid_key', sqlType: 'UUID', isNullable: false, isPrimaryKey: false, isUnique: true, ordinal: 3, sourceColumnName: 'uuid_key', origin: 'generated' },
    ] },
    { id: 2, name: 'orders', sourceDatasetId: 102, origin: 'generated', columns: [
      { id: 21, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, sourceColumnName: 'id', origin: 'generated' },
      { id: 22, name: 'customer_id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: false, isUnique: false, ordinal: 1, sourceColumnName: 'customer_id', origin: 'generated' },
    ] },
  ],
  relationships: [],
};

const invalidSuggestion: RelationshipSuggestion = {
  id: 77, projectId: 10, sourceDatasetId: 102, sourceTableName: 'orders', sourceColumnName: 'customer_id',
  targetDatasetId: 101, targetTableName: 'customers', targetColumnName: 'name', score: 0.88,
  evidenceJson: '{"reasons":["matching values"]}', status: 'suggested', createdAt: '',
};

describe('ProjectRelationshipsComponent', () => {
  let fixture: ComponentFixture<ProjectRelationshipsComponent>;
  let component: ProjectRelationshipsComponent;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    api = {
      getSuggestions: vi.fn(() => of([])),
      getDesign: vi.fn(() => of(structuredClone(schema))),
      detectSuggestions: vi.fn(() => of([])),
      acceptSuggestion: vi.fn(),
      rejectSuggestion: vi.fn(),
      createRelationship: vi.fn(),
      updateRelationship: vi.fn(),
      deleteRelationship: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [ProjectRelationshipsComponent],
      providers: [
        provideRouter([]),
        { provide: DesignApiService, useValue: api },
        { provide: DesignStateService, useValue: { design: vi.fn(() => null), loadForProject: vi.fn(() => of(structuredClone(schema))), reload: vi.fn(() => of(structuredClone(schema))) } },
        { provide: WorkflowStateService, useValue: { setProjectId: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectId: '10' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectRelationshipsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function selectByText(testId: string, text: string): HTMLSelectElement {
    const select = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement;
    const option = Array.from(select.options).find(item => item.textContent?.includes(text));
    expect(option, `${text} option`).toBeTruthy();
    select.value = option!.value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    return select;
  }

  function selectValidEndpoints(target = 'id · INTEGER'): void {
    selectByText('manual-source-table', 'orders');
    selectByText('manual-source-column', 'customer_id');
    selectByText('manual-target-table', 'customers');
    selectByText('manual-target-column', target);
  }

  it('renders the complete manual relationship form on the existing page', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="manual-relationship-form"]')).toBeTruthy();
    for (const id of ['manual-source-table', 'manual-source-column', 'manual-target-table', 'manual-target-column', 'manual-cardinality', 'manual-on-delete', 'create-manual-relationship', 'reset-manual-relationship']) {
      expect(fixture.nativeElement.querySelector(`[data-testid="${id}"]`), id).toBeTruthy();
    }
  });

  it('filters source and target columns when their persisted table selection changes', () => {
    selectByText('manual-source-table', 'orders');
    expect(component.sourceColumns().map(column => column.name)).toEqual(['id', 'customer_id']);
    selectByText('manual-target-table', 'customers');
    expect(component.targetColumns().map(column => column.name)).toEqual(['id', 'external_id', 'name', 'uuid_key']);
  });

  it('labels PK and Unique targets and disables non-key and incompatible options', () => {
    selectByText('manual-source-table', 'orders');
    selectByText('manual-source-column', 'customer_id');
    const target = selectByText('manual-target-table', 'customers').parentElement?.parentElement
      ?.querySelector('[data-testid="manual-target-column"]') as HTMLSelectElement;
    const options = Array.from(target.options);
    expect(options.find(item => item.textContent?.includes('id · INTEGER · PK'))?.disabled).toBe(false);
    expect(options.find(item => item.textContent?.includes('external_id · INTEGER · Unique'))?.disabled).toBe(false);
    expect(options.find(item => item.textContent?.includes('name · TEXT · not a PK or Unique'))?.disabled).toBe(true);
    expect(options.find(item => item.textContent?.includes('uuid_key · UUID · type mismatch'))?.disabled).toBe(true);
  });

  it('prevents incomplete, same-endpoint, non-key, type-mismatched, and duplicate submissions', () => {
    expect(component.canCreateManual()).toBe(false);
    component.manualFromTableId = 1;
    component.manualFromColumnId = 11;
    component.manualToTableId = 1;
    component.manualToColumnId = 11;
    expect(component.manualValidationMessage()).toContain('same endpoint');
    component.manualFromTableId = 2;
    component.manualFromColumnId = 22;
    component.manualToColumnId = 13;
    expect(component.manualValidationMessage()).toContain('Primary Key or Unique');
    component.manualToColumnId = 14;
    expect(component.manualValidationMessage()).toContain('must match');
    component.design.set({ ...structuredClone(schema), relationships: [{
      id: 31, fromColumnId: 22, fromTableId: 2, fromTableName: 'orders', fromColumnName: 'customer_id',
      toColumnId: 11, toTableId: 1, toTableName: 'customers', toColumnName: 'id',
      cardinality: 'many-to-one', onDelete: 'no-action', origin: 'user',
    }] });
    component.manualToColumnId = 11;
    expect(component.manualValidationMessage()).toContain('already exists');
  });

  it('creates a persisted relationship and refreshes the displayed relationship list', () => {
    const updated = structuredClone(schema);
    updated.revision = 6;
    updated.status = 'Draft';
    updated.relationships = [{
      id: 41, fromColumnId: 22, fromTableId: 2, fromTableName: 'orders', fromColumnName: 'customer_id',
      toColumnId: 11, toTableId: 1, toTableName: 'customers', toColumnName: 'id',
      cardinality: 'many-to-one', onDelete: 'no-action', origin: 'user',
    }];
    api['createRelationship'].mockReturnValue(of(updated));
    selectValidEndpoints();

    (fixture.nativeElement.querySelector('[data-testid="create-manual-relationship"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(api['createRelationship']).toHaveBeenCalledWith(9, 5, { fromColumnId: 22, toColumnId: 11, cardinality: 'many-to-one', onDelete: 'no-action' });
    expect(component.persistedRelationships()).toHaveLength(1);
    expect(component.design()?.status).toBe('Draft');
    expect(fixture.nativeElement.querySelector('[data-testid="persisted-relationships"]').textContent).toContain('orders.customer_id');
  });

  it('shows a structured duplicate conflict from the backend', () => {
    api['createRelationship'].mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 409, error: { message: 'An identical relationship already exists in this design.' },
    })));
    selectValidEndpoints();
    component.createManualRelationship();
    fixture.detectChanges();

    expect(component.errorMessage).toContain('identical relationship');
  });

  it('marks a detected non-key suggestion unavailable and disables Accept', () => {
    api['getSuggestions'].mockReturnValue(of([invalidSuggestion]));
    component.loadSuggestions();
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    const accept = Array.from(buttons)
      .find(button => button.textContent?.trim() === 'Accept') as HTMLButtonElement;

    expect(component.suggestionUnavailableReason(component.pending()[0])).toContain('neither Primary Key nor Unique');
    expect(accept.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Unavailable');
  });

  it('keeps all manual controls in the DOM for the mobile responsive layout', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();
    const form = fixture.nativeElement.querySelector('[data-testid="manual-relationship-form"]') as HTMLElement;
    expect(form.querySelectorAll('select')).toHaveLength(6);
    expect(form.querySelector('[data-testid="create-manual-relationship"]')).toBeTruthy();
    expect(form.className).toContain('glass-card');
    expect((fixture.nativeElement.querySelector('section') as HTMLElement).className).toContain('overflow-x-hidden');
    expect((fixture.nativeElement.querySelector('[data-testid="relationship-layout"]') as HTMLElement).className).toContain('min-w-0');
  });
});
