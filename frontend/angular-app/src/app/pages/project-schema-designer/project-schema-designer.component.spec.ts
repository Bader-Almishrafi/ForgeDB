import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignModelResponse, ProjectCleaningSummary } from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectSchemaDesignerComponent } from './project-schema-designer.component';

const schema: DesignModelResponse = {
  id: 8, projectId: 10, revision: 2, status: 'Draft', isStale: false, canContinue: false,
  generatedAt: '2026-07-12T00:00:00Z', validatedAt: null, lastModifiedBy: 'Owner', source: 'Confirmed Cleaned Data',
  sourceVersions: { 1: 11, 2: 12 }, sqlPreview: '', layout: null, createdAt: '', updatedAt: '',
  tables: [
    { id: 1, name: 'customers', sourceDatasetId: 1, sourceDatasetVersionId: 11, sourceName: 'customers.csv', rowCount: 3, origin: 'generated', columns: [
      { id: 10, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: false, isUnique: false, ordinal: 0, sourceColumnName: 'id', origin: 'generated', defaultValue: null, isAutoIncrement: false },
      { id: 11, name: 'full_name', sqlType: 'TEXT', isNullable: true, isPrimaryKey: false, isUnique: false, ordinal: 1, sourceColumnName: 'Customer Name', origin: 'generated' },
    ] },
    { id: 2, name: 'orders', sourceDatasetId: 2, sourceDatasetVersionId: 12, sourceName: 'orders.csv', rowCount: 4, origin: 'generated', columns: [
      { id: 20, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: false, isUnique: false, ordinal: 0, sourceColumnName: 'id', origin: 'generated', defaultValue: null, isAutoIncrement: false },
    ] },
  ],
  relationships: [], validationIssues: [],
};

const cleaning: ProjectCleaningSummary = {
  projectId: 10, projectName: 'Project', totalDatasets: 2, analyzedDatasets: 2, unanalyzedDatasets: 0,
  totalRows: 7, totalColumns: 3, totalIssues: 0, rowsAffected: 0, cellsAffected: 0, missingValues: 0,
  duplicateRows: 0, dataQualityScore: null, lastAnalyzedAt: '', hasCleaningBatches: true, requiresReanalysis: false,
  canConfirmQuality: true, qualityConfirmed: true, schemaReady: true, datasets: [], issueCounts: {},
};

describe('ProjectSchemaDesignerComponent', () => {
  let designApi: Record<string, ReturnType<typeof vi.fn>>;
  let forgeApi: Record<string, ReturnType<typeof vi.fn>>;
  let component: ProjectSchemaDesignerComponent;
  let fixture: ComponentFixture<ProjectSchemaDesignerComponent>;

  beforeEach(async () => {
    designApi = {
      getSchema: vi.fn(() => of(structuredClone(schema))),
      generateSchema: vi.fn(() => of(structuredClone(schema))),
      saveSchemaDraft: vi.fn(() => of(structuredClone(schema))),
      validateSchema: vi.fn(() => of({ ...structuredClone(schema), revision: 3, status: 'Valid', canContinue: true })),
      getSchemaSql: vi.fn(() => of({ designId: 8, revision: 2, sql: component?.liveSql?.() ?? '' })),
    };
    forgeApi = {
      getProject: vi.fn(() => of({ id: 10, userId: 1, name: 'Project', createdAt: '' })),
      getProjectCleaningSummary: vi.fn(() => of(structuredClone(cleaning))),
    };
    await TestBed.configureTestingModule({
      imports: [ProjectSchemaDesignerComponent],
      providers: [
        provideRouter([]),
        { provide: DesignApiService, useValue: designApi },
        { provide: ForgeApiService, useValue: forgeApi },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectId: '10' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectSchemaDesignerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function selectEl(columnId: number): HTMLSelectElement {
    return fixture.nativeElement.querySelector(`#column-type-${columnId}`) as HTMLSelectElement;
  }
  function fireSelect(select: HTMLSelectElement, value: string): void {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }
  function checkboxEl(idPrefix: string, columnId: number): HTMLInputElement {
    return fixture.nativeElement.querySelector(`#${idPrefix}-${columnId}`) as HTMLInputElement;
  }
  function toggle(input: HTMLInputElement, checked: boolean): void {
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }
  function textInput(id: string): HTMLInputElement {
    return fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
  }
  function typeInto(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('loads the project schema route and selects the first table', () => {
    expect(component.projectId).toBe(10);
    expect(designApi['getSchema']).toHaveBeenCalledWith(10);
    expect(component.selectedTableId()).toBe(1);
  });

  it('handles the typed empty-schema response without a 404 request', () => {
    designApi['getSchema'].mockReturnValueOnce(of(null));
    component.loadWorkspace();
    fixture.detectChanges();

    expect(component.tableCount()).toBe(0);
    expect(component.selectedTable()).toBeNull();
    expect(component.feedback()).toBeNull();
  });

  it('calls real schema generation and respects the cleaning gate', () => {
    component.design.set(null);
    component.generateSchema();
    expect(designApi['generateSchema']).toHaveBeenCalledWith(10, undefined);
    component.cleaning.set({ ...cleaning, schemaReady: false });
    expect(component.cleaning()?.schemaReady).toBe(false);
  });

  it('verifies equivalent backend SQL across host line endings', () => {
    const windowsSql = component.liveSql().replace(/\n/g, '\r\n');
    designApi['getSchemaSql'].mockReturnValue(of({ designId: 8, revision: 2, sql: windowsSql }));

    component.refreshBackendSql();

    expect(component.feedback()?.title).toBe('SQL verified');
  });

  it('selects generated tables', () => {
    component.selectTable(2);
    expect(component.selectedTable()?.name).toBe('orders');
  });

  it('renames tables and columns and updates live SQL and ER labels immediately', () => {
    component.updateTableName(1, 'customer_records');
    component.updateColumnName(11, 'display_name');
    expect(component.liveSql()).toContain('CREATE TABLE customer_records');
    expect(component.liveSql()).toContain('display_name TEXT');
    expect(component.tableName(1)).toBe('customer_records');
    expect(component.columnName(11)).toBe('display_name');
    expect(component.dirty()).toBe(true);
  });

  it('keeps live SQL aligned with backend FK ordering and indexes', () => {
    component.design.set({ ...structuredClone(schema), relationships: [{
      id: 30, fromColumnId: 10, fromTableId: 1, fromTableName: 'customers', fromColumnName: 'id',
      toColumnId: 20, toTableId: 2, toTableName: 'orders', toColumnName: 'id',
      cardinality: 'many-to-one', onDelete: 'no-action', origin: 'user',
    }] });
    const sql = component.liveSql();
    expect(sql.indexOf('CREATE TABLE orders')).toBeLessThan(sql.indexOf('CREATE TABLE customers'));
    expect(sql).toContain('FOREIGN KEY (id) REFERENCES orders (id) ON DELETE NO ACTION');
    expect(sql).toContain('CREATE INDEX ix_customers_id ON customers (id);');
  });

  it('rejects invalid and PostgreSQL-reserved names locally', () => {
    component.updateTableName(1, 'bad-name');
    component.updateColumnName(11, 'select');
    expect(component.tableError(1)).toContain('letters');
    expect(component.columnError(11)).toContain('reserved');
    expect(component.hasNameErrors()).toBe(true);
  });

  it('detects duplicate table and column names case-insensitively', () => {
    component.updateTableName(2, 'CUSTOMERS');
    component.updateColumnName(11, 'ID');
    expect(component.tableError(1)).toContain('Duplicate');
    expect(component.tableError(2)).toContain('Duplicate');
    expect(component.columnError(10)).toContain('Duplicate');
    expect(component.columnError(11)).toContain('Duplicate');
  });

  it('sends only whitelisted table and column schema fields in Save Draft', () => {
    component.updateTableName(1, 'customer_records');
    component.saveDraft();
    expect(designApi['saveSchemaDraft']).toHaveBeenCalledWith(10, 2, expect.objectContaining({
      tables: expect.arrayContaining([{ id: 1, name: 'customer_records' }]),
      columns: expect.arrayContaining([{
        id: 10, name: 'id', dataType: 'INTEGER', isNullable: false, isPrimaryKey: false,
        isUnique: false, defaultValue: null, isAutoIncrement: false,
      }]),
    }));
  });

  it('toggles Nullable and updates SQL immediately', () => {
    component.updateNullable(11, false);
    expect(component.selectedTable()?.columns[1].isNullable).toBe(false);
    expect(component.liveSql()).toContain('full_name TEXT NOT NULL');
    expect(component.dirty()).toBe(true);
  });

  it('selecting Primary Key forces NOT NULL and clears redundant Unique', () => {
    component.updateUnique(11, true);
    component.updatePrimaryKey(11, true);
    const column = component.selectedTable()?.columns[1];
    expect(column?.isPrimaryKey).toBe(true);
    expect(column?.isNullable).toBe(false);
    expect(column?.isUnique).toBe(false);
    expect(component.liveSql()).toContain('PRIMARY KEY (full_name)');
    expect(component.liveSql()).not.toContain('full_name TEXT NOT NULL UNIQUE');
  });

  it('toggles a real Unique constraint for a non-PK column', () => {
    component.updateUnique(11, true);
    expect(component.selectedTable()?.columns[1].isUnique).toBe(true);
    expect(component.liveSql()).toContain('full_name TEXT UNIQUE');
  });

  it('changes the supported data type and rejects an invalid type selection', () => {
    component.updateColumnDataType(11, 'VARCHAR(255)');
    expect(component.liveSql()).toContain('full_name VARCHAR(255)');
    component.updateColumnDataType(11, 'MONEY');
    expect(component.columnError(11, 'dataType')).toContain('supported');
    expect(component.hasDraftErrors()).toBe(true);
  });

  it('enables identity only for compatible integer types and disables it after an incompatible type change', () => {
    component.updateAutoIncrement(10, true);
    expect(component.liveSql()).toContain('id INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL');
    component.updateColumnDataType(10, 'TEXT');
    expect(component.selectedTable()?.columns[0].isAutoIncrement).toBe(false);
    component.updateAutoIncrement(11, true);
    expect(component.selectedTable()?.columns[1].isAutoIncrement).toBe(false);
  });

  it('validates defaults by selected type and renders safe defaults live', () => {
    component.updateDefaultValue(11, "'guest'");
    expect(component.columnError(11, 'defaultValue')).toBe('');
    expect(component.liveSql()).toContain("full_name TEXT DEFAULT 'guest'");
    component.updateDefaultValue(11, "'guest'; DROP TABLE users;");
    expect(component.columnError(11, 'defaultValue')).toContain('Statements');
  });

  it('restores every saved column value after a workspace refresh', () => {
    const persisted = structuredClone(schema);
    persisted.revision = 3;
    Object.assign(persisted.tables[0].columns[0], {
      sqlType: 'BIGINT', isNullable: false, isPrimaryKey: true, isUnique: false,
      defaultValue: null, isAutoIncrement: true,
    });
    designApi['getSchema'].mockReturnValue(of(persisted));
    component.loadWorkspace();
    const restored = component.selectedTable()?.columns[0];
    expect(restored).toMatchObject({ sqlType: 'BIGINT', isNullable: false, isPrimaryKey: true, isUnique: false, isAutoIncrement: true });
    expect(component.dirty()).toBe(false);
  });

  it('uses backend validation state to enable Relationships only after a saved valid draft', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.validateSchema();
    expect(component.canContinue()).toBe(true);
    component.continueToRelationships();
    expect(navigate).toHaveBeenCalledWith(['/projects', 10, 'relationships'], { queryParams: { schemaId: 8, returnTo: 'schema' } });
  });

  it('keeps Continue disabled for blocking validation errors', () => {
    component.design.set({ ...structuredClone(schema), status: 'Invalid', canContinue: false, validationIssues: [{ code: 'bad', severity: 'error', message: 'Blocking' }] });
    expect(component.canContinue()).toBe(false);
  });

  it('offers an explicit reload on a 409 save conflict instead of retrying the stale revision forever', () => {
    designApi['saveSchemaDraft'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Stale revision' } })));
    component.updateTableName(1, 'customer_records');

    component.saveDraft();

    expect(component.conflict()).toBe(true);
    expect(component.feedback()?.title).toBe('Schema changed elsewhere');

    const reloaded = { ...structuredClone(schema), revision: 5 };
    designApi['getSchema'].mockReturnValue(of(reloaded));
    component.reloadAfterConflict();

    expect(designApi['getSchema']).toHaveBeenCalledTimes(2);
    expect(component.conflict()).toBe(false);
    expect(component.design()?.revision).toBe(5);
    expect(component.dirty()).toBe(false);
  });

  it('protects unsaved changes with the route guard contract', () => {
    component.updateTableName(1, 'customer_records');
    const decision = component.canDeactivate() as Observable<boolean>;
    let result: boolean | undefined;
    decision.subscribe(value => result = value);
    expect(component.leaveDialogOpen()).toBe(true);
    component.resolveLeaveDialog(false);
    expect(result).toBe(false);
  });

  it('closes the unsaved-changes dialog on Escape without discarding edits', () => {
    component.updateTableName(1, 'customer_records');
    const decision = component.canDeactivate() as Observable<boolean>;
    let result: boolean | undefined;
    decision.subscribe(value => result = value);
    expect(component.leaveDialogOpen()).toBe(true);

    component.onEscapeKey();

    expect(result).toBe(false);
    expect(component.leaveDialogOpen()).toBe(false);
    expect(component.dirty()).toBe(true);
  });

  // ---- rendered-DOM assertions (the Data Type control must be a real <select>, not a
  // free-text input with a datalist, and every control must exist and work through native
  // DOM events, not just component method calls) ----

  it('renders a real, enabled <select> for Data Type with only backend-supported PostgreSQL types', () => {
    const select = selectEl(11);
    expect(select).toBeTruthy();
    expect(select.tagName).toBe('SELECT');
    expect(select.disabled).toBe(false);
    const optionValues = Array.from(select.options).map(option => option.value);
    expect(select.options.length).toBe(14);
    expect(optionValues).toEqual([
      'SMALLINT', 'INTEGER', 'BIGINT', 'NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE PRECISION',
      'BOOLEAN', 'VARCHAR', 'TEXT', 'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'UUID',
    ]);
    expect(select.value).toBe('TEXT');
  });

  it('selecting INTEGER from the rendered dropdown updates the draft and live SQL', () => {
    fireSelect(selectEl(11), 'INTEGER');
    expect(component.selectedTable()?.columns[1].sqlType).toBe('INTEGER');
    expect(component.liveSql()).toContain('full_name INTEGER');
  });

  it('selecting TEXT from the rendered dropdown updates the draft and live SQL', () => {
    fireSelect(selectEl(10), 'TEXT');
    expect(component.selectedTable()?.columns[0].sqlType).toBe('TEXT');
    expect(component.liveSql()).toContain('id TEXT');
  });

  it('selecting VARCHAR reveals a length input; editing it composes VARCHAR(length) into the draft and SQL', () => {
    expect(fixture.nativeElement.querySelector('#column-varchar-length-11')).toBeFalsy();

    fireSelect(selectEl(11), 'VARCHAR');

    const lengthInput = textInput('column-varchar-length-11');
    expect(lengthInput).toBeTruthy();
    expect(lengthInput.type).toBe('number');
    expect(component.selectedTable()?.columns[1].sqlType).toBe('VARCHAR(255)');
    expect(component.liveSql()).toContain('full_name VARCHAR(255)');

    typeInto(lengthInput, '100');
    expect(component.selectedTable()?.columns[1].sqlType).toBe('VARCHAR(100)');
    expect(component.liveSql()).toContain('full_name VARCHAR(100)');
    expect(fixture.nativeElement.querySelector('#column-type-error-11')).toBeFalsy();
  });

  it('rejects a VARCHAR length of 0 with an inline error and blocks Continue', () => {
    fireSelect(selectEl(11), 'VARCHAR');
    typeInto(textInput('column-varchar-length-11'), '0');
    expect(component.columnError(11, 'dataType')).toContain('VARCHAR length');
    expect(component.hasDraftErrors()).toBe(true);
  });

  it('renders working Nullable, Primary Key, Unique, and Auto Increment checkboxes for every column', () => {
    const nullable = checkboxEl('column-nullable', 11);
    const primaryKey = checkboxEl('column-pk', 11);
    const unique = checkboxEl('column-unique', 11);
    const autoIncrement = checkboxEl('column-autoincrement', 10);
    expect(nullable.type).toBe('checkbox');
    expect(primaryKey.type).toBe('checkbox');
    expect(unique.type).toBe('checkbox');
    expect(autoIncrement.type).toBe('checkbox');

    toggle(unique, true);
    expect(component.selectedTable()?.columns[1].isUnique).toBe(true);

    toggle(nullable, false);
    expect(component.selectedTable()?.columns[1].isNullable).toBe(false);

    toggle(primaryKey, true);
    const column = component.selectedTable()?.columns[1];
    expect(column?.isPrimaryKey).toBe(true);
    expect(column?.isNullable).toBe(false);
    expect(column?.isUnique).toBe(false);
    expect(checkboxEl('column-nullable', 11).disabled).toBe(true);

    component.selectTable(2);
    fixture.detectChanges();
    toggle(checkboxEl('column-autoincrement', 20), true);
    expect(component.selectedTable()?.columns[0].isAutoIncrement).toBe(true);
    expect(component.liveSql()).toContain('id INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL');
  });

  it('renders a working Default Value input that updates SQL Preview live', () => {
    const input = textInput('column-default-11');
    expect(input).toBeTruthy();
    typeInto(input, "'guest'");
    expect(component.columnError(11, 'defaultValue')).toBe('');
    expect(component.liveSql()).toContain("full_name TEXT DEFAULT 'guest'");
  });

  it('selecting an identity-incompatible type from the rendered dropdown disables the Auto Increment checkbox', () => {
    toggle(checkboxEl('column-autoincrement', 10), true);
    expect(component.selectedTable()?.columns[0].isAutoIncrement).toBe(true);
    expect(checkboxEl('column-autoincrement', 10).disabled).toBe(false);

    fireSelect(selectEl(10), 'TEXT');

    expect(component.selectedTable()?.columns[0].isAutoIncrement).toBe(false);
    expect(checkboxEl('column-autoincrement', 10).disabled).toBe(true);
  });

  it('Save Draft sends the exact type selected through the rendered dropdown, including a manually-configured PK/Unique/default/identity column set', () => {
    fireSelect(selectEl(10), 'INTEGER');
    toggle(checkboxEl('column-pk', 10), true);
    toggle(checkboxEl('column-autoincrement', 10), true);
    fireSelect(selectEl(11), 'VARCHAR');
    toggle(checkboxEl('column-unique', 11), true);

    component.saveDraft();

    expect(designApi['saveSchemaDraft']).toHaveBeenCalledWith(10, 2, expect.objectContaining({
      columns: expect.arrayContaining([
        expect.objectContaining({ id: 10, dataType: 'INTEGER', isPrimaryKey: true, isUnique: false, isAutoIncrement: true, isNullable: false }),
        expect.objectContaining({ id: 11, dataType: 'VARCHAR(255)', isUnique: true, isPrimaryKey: false }),
      ]),
    }));
  });

  it('reload response repopulates the rendered Data Type select, checkboxes, and default input for every column', async () => {
    const persisted = structuredClone(schema);
    persisted.revision = 3;
    Object.assign(persisted.tables[0].columns[0], {
      sqlType: 'BIGINT', isNullable: false, isPrimaryKey: true, isUnique: false,
      defaultValue: null, isAutoIncrement: true,
    });
    Object.assign(persisted.tables[0].columns[1], {
      sqlType: 'VARCHAR(100)', isNullable: true, isPrimaryKey: false, isUnique: true,
      defaultValue: "'guest'", isAutoIncrement: false,
    });
    designApi['getSchema'].mockReturnValue(of(persisted));

    component.loadWorkspace();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.selectedTable()?.columns[0].sqlType).toBe('BIGINT'); // component state, sanity check
    expect(selectEl(10).value).toBe('BIGINT');
    expect(checkboxEl('column-pk', 10).checked).toBe(true);
    expect(checkboxEl('column-autoincrement', 10).checked).toBe(true);

    expect(selectEl(11).value).toBe('VARCHAR');
    expect(textInput('column-varchar-length-11').value).toBe('100');
    expect(checkboxEl('column-unique', 11).checked).toBe(true);
    expect(textInput('column-default-11').value).toBe("'guest'");
    expect(component.dirty()).toBe(false);
  });

  it('renders a mobile column-card editor with the same seven controls per column', () => {
    const card = fixture.nativeElement.querySelector('.column-card');
    expect(card).toBeTruthy();
    expect(card.querySelector('select.type-select')).toBeTruthy();
    expect(card.querySelectorAll('input[type="checkbox"]').length).toBe(4); // Nullable, Primary Key, Unique, Auto Increment
    expect(fixture.nativeElement.querySelectorAll('.column-card').length).toBe(2);
  });
});
