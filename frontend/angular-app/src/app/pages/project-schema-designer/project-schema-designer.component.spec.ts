import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignModelResponse, ProjectWorkflow } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { ToastService } from '../../services/toast.service';
import { ProjectSchemaDesignerComponent } from './project-schema-designer.component';
import { DesignApiService } from './services/design-api.service';
import { ProjectSchemaDesignerService } from './services/project-schema-designer.service';

const workflow = (): ProjectWorkflow => ({
  projectId: 10,
  projectName: 'Orders',
  workflowState: 'SchemaDesign',
  currentStep: 'Schema Design',
  nextStep: 'Export and Deploy',
  recommendedRoute: '/projects/10/schema',
  canImport: true,
  canAnalyze: true,
  canClean: true,
  canBuildSchema: true,
  canExport: false,
  canDeploy: false,
  blockerCodes: ['schema_invalid'],
  blockingReasons: ['Validate the schema before continuing.'],
  datasets: [{
    datasetId: 2,
    datasetName: 'orders',
    activeVersionId: 12,
    activeVersionNumber: 2,
    rowCount: 25,
    columnCount: 2,
    hasCurrentAnalysis: true,
    requiresAnalysis: false,
    isQualityConfirmed: true,
  }],
  schemaStatus: 'Invalid',
  latestDeploymentStatus: null,
});

const design = (): DesignModelResponse => ({
  id: 20,
  projectId: 10,
  revision: 4,
  status: 'Invalid',
  isStale: false,
  canContinue: false,
  generatedAt: '2026-07-20T09:00:00Z',
  validatedAt: '2026-07-20T09:05:00Z',
  sourceVersions: { 2: 12 },
  layout: null,
  createdAt: '2026-07-20T09:00:00Z',
  updatedAt: '2026-07-20T09:05:00Z',
  tables: [{
    id: 1,
    name: 'orders',
    sourceDatasetId: 2,
    sourceDatasetVersionId: 12,
    sourceName: 'orders',
    rowCount: 25,
    origin: 'generated',
    columns: [{
      id: 11,
      name: 'customer_id',
      sqlType: 'INTEGER',
      isNullable: false,
      isPrimaryKey: false,
      isUnique: false,
      ordinal: 0,
      sourceColumnName: 'customer_id',
      origin: 'generated',
      defaultValue: null,
      isAutoIncrement: false,
    }],
  }],
  relationships: [],
  validationIssues: [
    {
      code: 'missing_reference',
      severity: 'error',
      message: 'Customer ID must reference a unique target.',
      tableId: 1,
      columnId: 11,
    },
    {
      code: 'naming_review',
      severity: 'warning',
      message: 'Review this generated name.',
      tableId: 1,
    },
  ],
});

function contextStub(workflowSignal = signal<ProjectWorkflow | null>(workflow())) {
  return {
    workflow: workflowSignal,
    error: signal(null),
    load: vi.fn(() => of(workflowSignal())),
    setDatasetFromQuery: vi.fn(),
  };
}

function apiStubs(model = design()) {
  return {
    schemaApi: {
      getSchema: vi.fn(() => of(model)),
      getSchemaSql: vi.fn(() => of({ revision: model.revision, sql: 'CREATE TABLE orders ();' })),
      getSuggestions: vi.fn(() => of([])),
      generateSchema: vi.fn(() => of(model)),
      saveSchemaDraft: vi.fn(() => of(model)),
      validateSchema: vi.fn(() => of(model)),
      isRevisionConflict: vi.fn(() => false),
    },
    forgeApi: {
      getDatasetVersions: vi.fn(() => of([])),
    },
  };
}

describe('ProjectSchemaDesignerService', () => {
  let context: ReturnType<typeof contextStub>;
  let schemaApi: ReturnType<typeof apiStubs>['schemaApi'];
  let toast: { showSuccess: ReturnType<typeof vi.fn>; showError: ReturnType<typeof vi.fn>; showWarning: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    context = contextStub();
    schemaApi = apiStubs().schemaApi;
    toast = { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        ProjectSchemaDesignerService,
        { provide: DesignApiService, useValue: schemaApi },
        { provide: ForgeApiService, useValue: apiStubs().forgeApi },
        { provide: ProjectWorkflowContextService, useValue: context },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  it('blocks Save changes while a dirty draft has client-side validation errors', () => {
    const service = TestBed.inject(ProjectSchemaDesignerService);
    service.loading.set(false);
    const model = design();
    service.design.set({ ...model, validationIssues: [] });
    service.tableNames.set({ 1: 'orders' });
    service.columnDrafts.set({
      11: {
        name: 'customer_id',
        sqlType: 'INTEGER',
        isNullable: false,
        isPrimaryKey: false,
        isUnique: false,
        defaultValue: null,
        isAutoIncrement: false,
      },
    });

    service.updateTableName(1, 'bad table name');

    expect(service.dirty()).toBe(true);
    expect(service.hasDraftErrors()).toBe(true);
    expect(service.draftIssues()[0].location).toBe('bad table name');
    expect(service.canSave()).toBe(false);

    service.updateTableName(1, 'renamed_orders');

    expect(service.hasDraftErrors()).toBe(false);
    expect(service.canSave()).toBe(true);
  });

  it('keeps valid dataset deep links and clears dataset IDs outside the loaded project', () => {
    const service = TestBed.inject(ProjectSchemaDesignerService);

    service.init(10, 2);
    expect(service.datasetId()).toBe(2);
    expect(context.setDatasetFromQuery).toHaveBeenLastCalledWith(2);

    service.init(10, 999);
    expect(service.datasetId()).toBeNull();
    expect(context.setDatasetFromQuery).toHaveBeenLastCalledWith(null);
  });

  it('keeps only the latest SQL preview response and loading state', () => {
    const first = new Subject<{ revision: number; sql: string }>();
    const second = new Subject<{ revision: number; sql: string }>();
    schemaApi.getSchemaSql
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const service = TestBed.inject(ProjectSchemaDesignerService);
    service.projectId = 10;
    service.design.set(design());

    service.refreshSqlPreview();
    service.refreshSqlPreview();
    first.next({ revision: 3, sql: 'STALE SQL' });
    first.complete();

    expect(service.sqlPreview()).toBe('');
    expect(service.sqlLoading()).toBe(true);

    second.next({ revision: 4, sql: 'CURRENT SQL' });
    second.complete();

    expect(service.sqlPreview()).toBe('CURRENT SQL');
    expect(service.sqlRevision()).toBe(4);
    expect(service.sqlLoading()).toBe(false);
  });

  it('locks every schema mutation and draft edit while generation is in progress', () => {
    const service = TestBed.inject(ProjectSchemaDesignerService);
    service.loading.set(false);
    service.design.set(design());
    service.tableNames.set({ 1: 'orders' });
    service.columnDrafts.set({
      11: {
        name: 'customer_id',
        sqlType: 'INTEGER',
        isNullable: false,
        isPrimaryKey: false,
        isUnique: false,
        defaultValue: null,
        isAutoIncrement: false,
      },
    });
    service.updateTableName(1, 'renamed_orders');

    expect(service.canUndo()).toBe(true);
    service.generating.set(true);

    expect(service.draftEditingDisabled()).toBe(true);
    expect(service.canUndo()).toBe(false);
    expect(service.canSave()).toBe(false);
    expect(service.canValidate()).toBe(false);
    expect(service.canMutateRelationships()).toBe(false);

    service.updateTableName(1, 'lost_edit');
    service.updateColumnName(11, 'lost_column_edit');
    service.undoChange();

    expect(service.tableNames()[1]).toBe('renamed_orders');
    expect(service.columnDrafts()[11].name).toBe('customer_id');
  });

  it('keeps the current draft and requires a reload when a saved schema cannot be refreshed', () => {
    const service = TestBed.inject(ProjectSchemaDesignerService);
    service.projectId = 10;
    service.loading.set(false);
    service.design.set(design());
    service.tableNames.set({ 1: 'orders' });
    service.columnDrafts.set({
      11: {
        name: 'customer_id',
        sqlType: 'INTEGER',
        isNullable: false,
        isPrimaryKey: false,
        isUnique: false,
        defaultValue: null,
        isAutoIncrement: false,
      },
    });
    service.updateTableName(1, 'renamed_orders');
    schemaApi.getSchema.mockReturnValue(throwError(() => new Error('refresh failed')));

    service.saveDraft();

    expect(schemaApi.saveSchemaDraft).toHaveBeenCalledOnce();
    expect(service.design()?.revision).toBe(4);
    expect(service.tableNames()[1]).toBe('renamed_orders');
    expect(service.conflict()).toBe(true);
    expect(service.feedback()).toEqual({
      kind: 'warning',
      title: 'Changes saved; refresh required',
      message: 'The change was accepted, but the latest schema could not be reloaded. Reload before making another change.',
    });
    expect(toast.showSuccess).not.toHaveBeenCalled();
    expect(toast.showWarning).toHaveBeenCalledOnce();
  });

  it('locks global schema actions and navigation during a relationship mutation', () => {
    const service = TestBed.inject(ProjectSchemaDesignerService);
    const readyWorkflow: ProjectWorkflow = {
      ...workflow(),
      canExport: true,
      canDeploy: true,
      schemaStatus: 'Valid',
      blockerCodes: [],
      blockingReasons: [],
    };
    const readyDesign: DesignModelResponse = { ...design(), status: 'Valid' };
    context.workflow.set(readyWorkflow);
    service.loading.set(false);
    service.design.set(readyDesign);
    service.tableNames.set({ 1: 'orders' });
    service.columnDrafts.set({
      11: {
        name: 'customer_id',
        sqlType: 'INTEGER',
        isNullable: false,
        isPrimaryKey: false,
        isUnique: false,
        defaultValue: null,
        isAutoIncrement: false,
      },
    });

    expect(service.canContinue()).toBe(true);
    service.setRelationshipMutationBusy(true);

    expect(service.canGenerate()).toBe(false);
    expect(service.canValidate()).toBe(false);
    expect(service.canMutateRelationships()).toBe(false);
    expect(service.canContinue()).toBe(false);
  });
});

describe('ProjectSchemaDesignerComponent', () => {
  beforeEach(async () => {
    const context = contextStub();
    const stubs = apiStubs();
    await TestBed.configureTestingModule({
      imports: [ProjectSchemaDesignerComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            parent: null,
            snapshot: {
              paramMap: convertToParamMap({ projectId: '10' }),
              queryParamMap: convertToParamMap({ datasetId: '2' }),
            },
          },
        },
        { provide: DesignApiService, useValue: stubs.schemaApi },
        { provide: ForgeApiService, useValue: stubs.forgeApi },
        { provide: ProjectWorkflowContextService, useValue: context },
        { provide: ToastService, useValue: { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('provides four focused sections and renders validation issues with their locations', () => {
    const fixture = TestBed.createComponent(ProjectSchemaDesignerComponent);
    fixture.detectChanges();
    fixture.componentInstance.activeTab.set('validation');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const validation = element.querySelector('[data-testid="schema-validation"]');

    expect(element.querySelectorAll('[role="tab"]').length).toBe(4);
    expect(validation).not.toBeNull();
    expect(validation?.textContent).toContain('Customer ID must reference a unique target.');
    expect(validation?.textContent).toContain('orders / customer_id');
    expect(validation?.textContent).toContain('Review this generated name.');

    (validation?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTab()).toBe('tables');
    expect(fixture.componentInstance.service.selectedTableId()).toBe(1);
  });

  it('keeps relationship CRUD available for self-references in a one-table schema', () => {
    const fixture = TestBed.createComponent(ProjectSchemaDesignerComponent);
    fixture.detectChanges();
    fixture.componentInstance.activeTab.set('relationships');
    fixture.detectChanges();

    const relationshipTab = fixture.nativeElement.querySelector('#schema-tab-relationships') as HTMLButtonElement;
    expect(relationshipTab.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="schema-relationships"]')).toBeTruthy();
  });

  it('keeps the relationship panel mounted until its mutation finishes', () => {
    const fixture = TestBed.createComponent(ProjectSchemaDesignerComponent);
    fixture.detectChanges();
    fixture.componentInstance.activeTab.set('relationships');
    fixture.componentInstance.service.setRelationshipMutationBusy(true);
    fixture.detectChanges();

    const tabs = Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];
    const relationshipTab = tabs.find((tab) => tab.id === 'schema-tab-relationships')!;
    const otherTabs = tabs.filter((tab) => tab !== relationshipTab);

    expect(relationshipTab.disabled).toBe(false);
    expect(otherTabs.every((tab) => tab.disabled)).toBe(true);
    relationshipTab.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    }));
    fixture.detectChanges();

    expect(fixture.componentInstance.activeTab()).toBe('relationships');
    expect(fixture.nativeElement.querySelector('[data-testid="schema-relationships"]')).toBeTruthy();
  });

  it('moves focus to the persistent schema heading after regeneration is confirmed', async () => {
    const fixture = TestBed.createComponent(ProjectSchemaDesignerComponent);
    fixture.detectChanges();
    const generate = vi.spyOn(fixture.componentInstance.service, 'generateSchema').mockImplementation(() => undefined);

    fixture.componentInstance.confirmRegenerate();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));

    expect(generate).toHaveBeenCalledWith(true);
    expect(document.activeElement?.textContent).toBe('Schema Design');
  });

  it('disables every table draft editor while a schema mutation is in progress', () => {
    const fixture = TestBed.createComponent(ProjectSchemaDesignerComponent);
    fixture.detectChanges();
    fixture.componentInstance.service.generating.set(true);
    fixture.detectChanges();

    const editors = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="tables-and-columns"] input, [data-testid="tables-and-columns"] select'),
    ) as Array<HTMLInputElement | HTMLSelectElement>;

    expect(editors.length).toBeGreaterThan(0);
    expect(editors.filter((editor) => !editor.matches(':disabled')).map((editor) => editor.id)).toEqual([]);
  });
});
