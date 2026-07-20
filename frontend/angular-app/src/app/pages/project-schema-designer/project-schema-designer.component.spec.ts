import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetVersion, DesignModelResponse, ProjectWorkflow, SaveDesignDraftRequest } from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { ProjectSchemaDesignerComponent } from './project-schema-designer.component';

const baseSchema = (): DesignModelResponse => ({
  id: 8,
  projectId: 10,
  revision: 2,
  status: 'Draft',
  isStale: false,
  canContinue: false,
  generatedAt: '2026-07-12T00:00:00Z',
  validatedAt: null,
  lastModifiedBy: 'Owner',
  source: 'Confirmed active versions',
  sourceVersions: { 1: 11, 2: 12 },
  layout: null,
  createdAt: '',
  updatedAt: '',
  tables: [
    {
      id: 1,
      name: 'customers',
      sourceDatasetId: 1,
      sourceDatasetVersionId: 11,
      sourceName: 'customers.csv',
      rowCount: 3,
      origin: 'generated',
      columns: [
        { id: 10, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, sourceColumnName: 'Customer ID', origin: 'generated', defaultValue: null, isAutoIncrement: false },
        { id: 11, name: 'full_name', sqlType: 'TEXT', isNullable: true, isPrimaryKey: false, isUnique: false, ordinal: 1, sourceColumnName: 'Customer Name', origin: 'generated', defaultValue: null, isAutoIncrement: false },
      ],
    },
    {
      id: 2,
      name: 'orders',
      sourceDatasetId: 2,
      sourceDatasetVersionId: 12,
      sourceName: 'orders.xlsx',
      rowCount: 4,
      origin: 'generated',
      columns: [
        { id: 20, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, sourceColumnName: 'Order ID', origin: 'generated', defaultValue: null, isAutoIncrement: false },
        { id: 21, name: 'customer_id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: false, isUnique: false, ordinal: 1, sourceColumnName: 'Customer ID', origin: 'generated', defaultValue: null, isAutoIncrement: false },
      ],
    },
  ],
  relationships: [],
  validationIssues: [],
});

const baseWorkflow = (): ProjectWorkflow => ({
  projectId: 10,
  projectName: 'Schema project',
  workflowState: 'SchemaDraft',
  currentStep: 'Schema',
  nextStep: 'ExportDeploy',
  recommendedRoute: '/projects/10/schema',
  canImport: true,
  canAnalyze: true,
  canClean: true,
  canBuildSchema: true,
  canExport: false,
  canDeploy: false,
  blockerCodes: ['schema_invalid'],
  blockingReasons: ['Complete and validate the schema before export or deployment.'],
  schemaStatus: 'Draft',
  datasets: [
    { datasetId: 1, datasetName: 'customers', activeVersionId: 11, activeVersionNumber: 2, rowCount: 3, columnCount: 2, hasCurrentAnalysis: true, requiresAnalysis: false, isQualityConfirmed: true },
    { datasetId: 2, datasetName: 'orders', activeVersionId: 12, activeVersionNumber: 1, rowCount: 4, columnCount: 2, hasCurrentAnalysis: true, requiresAnalysis: false, isQualityConfirmed: true },
  ],
});

const versions: Record<number, DatasetVersion[]> = {
  1: [{ id: 11, datasetId: 1, parentVersionId: 7, versionNumber: 2, isRawOriginal: false, isActive: true, rowCount: 3, columnCount: 2, operationSummary: 'Fill missing values', createdAt: '', analyzedAt: '', createdBy: 'Owner' }],
  2: [{ id: 12, datasetId: 2, parentVersionId: null, versionNumber: 1, isRawOriginal: true, isActive: true, rowCount: 4, columnCount: 2, operationSummary: 'Original imported dataset', createdAt: '', analyzedAt: '', createdBy: 'Owner' }],
};

interface SetupOptions {
  schema?: DesignModelResponse | null;
  workflow?: ProjectWorkflow;
  datasetId?: string | null;
}

async function setup(options: SetupOptions = {}): Promise<{
  component: ProjectSchemaDesignerComponent;
  fixture: ComponentFixture<ProjectSchemaDesignerComponent>;
  designApi: Record<string, ReturnType<typeof vi.fn>>;
  workflowContext: Record<string, unknown>;
  setSchema: (schema: DesignModelResponse | null) => void;
  setWorkflow: (workflow: ProjectWorkflow) => void;
}> {
  let currentSchema = options.schema === undefined ? baseSchema() : options.schema;
  let currentWorkflow = options.workflow ?? baseWorkflow();
  const workflowSignal = signal<ProjectWorkflow | null>(structuredClone(currentWorkflow));
  const errorSignal = signal(null);
  const workflowContext = {
    workflow: workflowSignal.asReadonly(),
    error: errorSignal.asReadonly(),
    setDatasetFromQuery: vi.fn(),
    load: vi.fn((_projectId: number, _force = false) => {
      workflowSignal.set(structuredClone(currentWorkflow));
      return of(structuredClone(currentWorkflow));
    }),
  };
  const designApi: Record<string, ReturnType<typeof vi.fn>> = {
    getSchema: vi.fn(() => of(currentSchema ? structuredClone(currentSchema) : null)),
    generateSchema: vi.fn(() => {
      currentSchema = baseSchema();
      return of(structuredClone(currentSchema));
    }),
    saveSchemaDraft: vi.fn((_projectId: number, _revision: number, request: SaveDesignDraftRequest) => {
      if (!currentSchema) throw new Error('missing schema');
      currentSchema = {
        ...structuredClone(currentSchema),
        revision: currentSchema.revision + 1,
        status: 'Draft',
        tables: currentSchema.tables.map((table) => ({
          ...table,
          name: request.tables.find((item) => item.id === table.id)?.name ?? table.name,
          columns: table.columns.map((column) => {
            const saved = request.columns.find((item) => item.id === column.id);
            return saved ? { ...column, ...saved, sqlType: saved.dataType } : column;
          }),
        })),
      };
      return of(structuredClone(currentSchema));
    }),
    validateSchema: vi.fn(() => of(currentSchema ? structuredClone(currentSchema) : null)),
    getSchemaSql: vi.fn(() => of({ designId: 8, revision: currentSchema?.revision ?? 0, sql: 'CREATE TABLE customers (id INTEGER PRIMARY KEY);' })),
    getSuggestions: vi.fn(() => of([])),
    detectSuggestions: vi.fn(() => of([])),
    acceptSuggestion: vi.fn(),
    rejectSuggestion: vi.fn(),
    createRelationship: vi.fn(),
    updateRelationship: vi.fn(),
    deleteRelationship: vi.fn(),
    isRevisionConflict: vi.fn((error: { status?: number }) => error?.status === 409),
  };
  const forgeApi = {
    getDatasetVersions: vi.fn((_projectId: number, datasetId: number) => of(structuredClone(versions[datasetId] ?? []))),
  };
  await TestBed.configureTestingModule({
    imports: [ProjectSchemaDesignerComponent],
    providers: [
      provideRouter([]),
      { provide: DesignApiService, useValue: designApi },
      { provide: ForgeApiService, useValue: forgeApi },
      { provide: ProjectWorkflowContextService, useValue: workflowContext },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({ projectId: '10' }),
            queryParamMap: convertToParamMap(options.datasetId ? { datasetId: options.datasetId } : {}),
          },
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ProjectSchemaDesignerComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();
  return {
    component,
    fixture,
    designApi,
    workflowContext,
    setSchema: (schema) => { currentSchema = schema; },
    setWorkflow: (workflow) => { currentWorkflow = workflow; },
  };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('ProjectSchemaDesignerComponent', () => {
  it('uses the backend workflow to block Schema actions and display the first reason', async () => {
    const workflow = { ...baseWorkflow(), canBuildSchema: false, blockerCodes: ['analysis_stale'], blockingReasons: ['Re-analyze the active dataset version.'] };
    const { component, fixture, designApi } = await setup({ workflow });
    expect(component.schemaBlocked()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="schema-workflow-blocker"]').textContent).toContain('Re-analyze the active dataset version.');
    component.generateSchema();
    component.saveDraft();
    component.validateSchema();
    expect(designApi['generateSchema']).not.toHaveBeenCalled();
    expect(designApi['saveSchemaDraft']).not.toHaveBeenCalled();
    expect(designApi['validateSchema']).not.toHaveBeenCalled();
  });

  it('renders the no-schema state and generates from the backend', async () => {
    const workflow = { ...baseWorkflow(), schemaStatus: 'None', blockerCodes: ['schema_required'], blockingReasons: ['Generate a schema.'] };
    const { component, fixture, designApi, workflowContext } = await setup({ schema: null, workflow });
    expect(fixture.nativeElement.querySelector('[data-testid="schema-empty-state"]')).toBeTruthy();
    component.generateSchema();
    fixture.detectChanges();
    expect(designApi['generateSchema']).toHaveBeenCalledWith(10, undefined);
    expect(component.selectedTableId()).toBe(1);
    expect(workflowContext['load']).toHaveBeenCalledWith(10, true);
  });

  it('loads an existing schema, selects tables, and displays exact source versions', async () => {
    const { component, fixture, designApi } = await setup();
    expect(designApi['getSchema']).toHaveBeenCalledWith(10);
    expect(component.selectedTableId()).toBe(1);
    component.selectTable(2);
    expect(component.selectedTable()?.name).toBe('orders');
    const sources = fixture.nativeElement.querySelector('[data-testid="schema-source-versions"]') as HTMLElement;
    expect(sources.textContent).toContain('customers');
    expect(sources.textContent).toContain('v2');
    expect(sources.textContent).toContain('Cleaned');
    expect(sources.textContent).toContain('Quality confirmed');
    expect(sources.textContent).toContain('Analyzed');
  });

  it('marks a stale schema and prevents save, validation, relationships, and continuation', async () => {
    const stale = { ...baseSchema(), isStale: true };
    const workflow = { ...baseWorkflow(), schemaStatus: 'Stale', blockerCodes: ['schema_stale'], blockingReasons: ['The schema references an older version.'] };
    const { component, fixture, designApi } = await setup({ schema: stale, workflow });
    expect(fixture.nativeElement.querySelector('[data-testid="stale-schema"]')).toBeTruthy();
    expect(component.canValidate()).toBe(false);
    expect(component.canMutateRelationships()).toBe(false);
    expect(component.canContinue()).toBe(false);
    component.validateSchema();
    expect(designApi['validateSchema']).not.toHaveBeenCalled();
  });

  it('confirms regeneration and warns that edits and relationships may be replaced', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { component, designApi } = await setup();
    component.updateTableName(1, 'local_unsaved_name');
    component.generateSchema();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Unsaved edits will be lost'));
    expect(designApi['generateSchema']).toHaveBeenCalledWith(10, 2);
    expect(component.dirty()).toBe(false);
  });

  it('edits table and column fields with primary-key and identity rules', async () => {
    const { component } = await setup();
    component.updateTableName(1, 'customer_records');
    component.updateColumnName(11, 'display_name');
    component.updateUnique(11, true);
    component.updatePrimaryKey(11, true);
    const primary = component.selectedTable()?.columns[1];
    expect(primary).toMatchObject({ name: 'display_name', isPrimaryKey: true, isNullable: false, isUnique: false });
    component.updateAutoIncrement(10, true);
    expect(component.selectedTable()?.columns[0].isAutoIncrement).toBe(true);
    component.updateColumnDataType(10, 'TEXT');
    expect(component.selectedTable()?.columns[0].isAutoIncrement).toBe(false);
  });

  it('provides VARCHAR length and prevents duplicate table and column names', async () => {
    const { component } = await setup();
    component.updateColumnDataType(11, 'VARCHAR');
    component.updateVarcharLength(11, 120);
    expect(component.selectedTable()?.columns[1].sqlType).toBe('VARCHAR(120)');
    component.updateTableName(2, 'CUSTOMERS');
    component.updateColumnName(11, 'ID');
    expect(component.tableError(1)).toContain('Duplicate');
    expect(component.columnError(10)).toContain('Duplicate');
  });

  it('saves only persisted table and column fields, reloads, clears dirty state, and refreshes workflow', async () => {
    const { component, designApi, workflowContext } = await setup();
    component.updateTableName(1, 'customer_records');
    component.updateColumnDataType(11, 'VARCHAR');
    component.updateVarcharLength(11, 120);
    component.saveDraft();
    expect(designApi['saveSchemaDraft']).toHaveBeenCalledWith(10, 2, expect.objectContaining({
      tables: expect.arrayContaining([{ id: 1, name: 'customer_records' }]),
      columns: expect.arrayContaining([expect.objectContaining({ id: 11, dataType: 'VARCHAR(120)' })]),
    }));
    expect(component.design()?.revision).toBe(3);
    expect(component.dirty()).toBe(false);
    expect(workflowContext['load']).toHaveBeenCalledWith(10, true);
  });

  it('protects unsaved changes through the route guard contract', async () => {
    const { component } = await setup();
    component.updateTableName(1, 'customer_records');
    const decision = component.canDeactivate() as Observable<boolean>;
    let result: boolean | undefined;
    decision.subscribe((value) => result = value);
    expect(component.leaveDialogOpen()).toBe(true);
    component.resolveLeaveDialog(false);
    expect(result).toBe(false);
  });

  it('shows revision conflict recovery without overwriting server data', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { component, designApi, setSchema } = await setup();
    designApi['saveSchemaDraft'].mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Stale revision' } })));
    component.updateTableName(1, 'customer_records');
    component.saveDraft();
    expect(component.conflict()).toBe(true);
    expect(component.feedback()?.title).toBe('Schema changed elsewhere');
    setSchema({ ...baseSchema(), revision: 8 });
    component.reloadAfterConflict();
    expect(component.design()?.revision).toBe(8);
    expect(component.dirty()).toBe(false);
  });

  it('validates only the persisted schema and displays blocking errors and warnings', async () => {
    const { component, fixture, designApi, setSchema } = await setup();
    const validated = {
      ...baseSchema(),
      revision: 3,
      status: 'Invalid',
      validatedAt: '2026-07-20T00:00:00Z',
      validationIssues: [
        { code: 'duplicate-table', severity: 'error', message: 'Duplicate table.', tableId: 1 },
        { code: 'missing-index', severity: 'warning', message: 'Consider an index.', tableId: 2, columnId: 21 },
      ],
    };
    designApi['validateSchema'].mockImplementationOnce(() => { setSchema(validated); return of(validated); });
    component.validateSchema();
    fixture.detectChanges();
    expect(designApi['validateSchema']).toHaveBeenCalledWith(10, 2);
    expect(fixture.nativeElement.querySelector('[data-testid="schema-validation"]').textContent).toContain('Duplicate table.');
    expect(fixture.nativeElement.querySelector('[data-testid="schema-validation"]').textContent).toContain('Consider an index.');
  });

  it('uses only backend SQL and labels it as last saved while local edits are dirty', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { component, fixture, designApi } = await setup();
    expect(designApi['getSchemaSql']).toHaveBeenCalledWith(10);
    expect(component.sqlPreview()).toContain('CREATE TABLE customers');
    component.updateTableName(1, 'unsaved_name');
    component.sqlOpen.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="sql-preview"]').textContent).toContain('last saved schema');
    component.copySql();
    expect(writeText).toHaveBeenCalledWith('CREATE TABLE customers (id INTEGER PRIMARY KEY);');
    expect('liveSql' in component).toBe(false);
  });

  it('refreshes workflow and backend SQL after an integrated relationship mutation', async () => {
    const workflow = { ...baseWorkflow(), canExport: true, schemaStatus: 'Valid', blockerCodes: [], blockingReasons: [] };
    const { component, designApi, workflowContext } = await setup({ schema: { ...baseSchema(), status: 'Valid' }, workflow });
    expect(component.canContinue()).toBe(true);
    const changed = { ...baseSchema(), revision: 3, status: 'Draft' };
    component.handleRelationshipChanged(changed);
    expect(component.design()?.revision).toBe(3);
    expect(component.canContinue()).toBe(false);
    expect(designApi['getSchemaSql']).toHaveBeenCalledTimes(2);
    expect(workflowContext['load']).toHaveBeenCalledWith(10, true);
  });

  it('controls Continue with Workflow API and preserves a valid datasetId', async () => {
    const workflow = { ...baseWorkflow(), canExport: true, schemaStatus: 'Valid', blockerCodes: [], blockingReasons: [] };
    const valid = { ...baseSchema(), status: 'Valid', canContinue: true };
    const { component } = await setup({ schema: valid, workflow, datasetId: '1' });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    expect(component.canContinue()).toBe(true);
    component.continueToExport();
    expect(navigate).toHaveBeenCalledWith(['/projects', 10, 'export-deploy'], { queryParams: { datasetId: 1 } });
  });

  it('does not preserve a datasetId that does not belong to the project', async () => {
    const workflow = { ...baseWorkflow(), canExport: true, schemaStatus: 'Valid', blockerCodes: [], blockingReasons: [] };
    const { component, workflowContext } = await setup({ schema: { ...baseSchema(), status: 'Valid' }, workflow, datasetId: '999' });
    expect(component.datasetId()).toBeNull();
    expect(workflowContext['setDatasetFromQuery']).toHaveBeenCalledWith(null);
  });

  it('renders one scrolling layout without Tables, SQL, or Constraints tabs', async () => {
    const { fixture } = await setup();
    const page = fixture.nativeElement.querySelector('[data-testid="schema-page"]') as HTMLElement;
    expect(page.querySelector('[role="tablist"]')).toBeNull();
    expect(page.querySelector('[data-testid="tables-and-columns"]')).toBeTruthy();
    expect(page.querySelector('[data-testid="schema-relationships"]')).toBeTruthy();
    expect(page.querySelector('[data-testid="schema-validation"]')).toBeTruthy();
    expect(page.querySelector('[data-testid="sql-preview"]')).toBeTruthy();
  });
});
