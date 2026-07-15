import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeploymentResponse, DesignModelResponse } from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';
import { FileDownloadService } from '../../services/file-download.service';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { ProjectDeploymentComponent } from './project-deployment.component';

const design: DesignModelResponse = {
  id: 2,
  projectId: 10,
  revision: 4,
  status: 'Valid',
  layout: null,
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-15T00:00:00Z',
  validationIssues: [],
  relationships: [{
    id: 5,
    fromColumnId: 22,
    fromTableId: 2,
    fromTableName: 'orders',
    fromColumnName: 'customer_id',
    toColumnId: 11,
    toTableId: 1,
    toTableName: 'customers',
    toColumnName: 'id',
    cardinality: 'many-to-one',
    onDelete: 'no-action',
    origin: 'user',
  }],
  tables: [{
    id: 1,
    name: 'customers',
    origin: 'generated',
    columns: [{ id: 11, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, origin: 'generated' }],
  }, {
    id: 2,
    name: 'orders',
    origin: 'generated',
    columns: [{ id: 22, name: 'customer_id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: false, isUnique: false, ordinal: 0, origin: 'generated' }],
  }],
};

const completed: DeploymentResponse = {
  deploymentId: 91,
  id: 91,
  projectId: 10,
  designRevision: 4,
  schemaName: 'forgedb_project_10',
  status: 'Completed',
  generatedSql: 'CREATE TABLE customers (id INTEGER);',
  createdTables: ['customers', 'orders'],
  insertedRowCounts: { customers: 3, orders: 9 },
  tablesCreated: 2,
  rowsSeeded: 12,
  totalRowsInserted: 12,
  relationshipsCreated: 1,
  failedRows: 0,
  schemaSqlAvailable: true,
  seedSqlAvailable: true,
  deploySqlAvailable: true,
  startedAt: '2026-07-15T10:00:00Z',
  completedAt: '2026-07-15T10:00:01Z',
};

describe('ProjectDeploymentComponent', () => {
  const deployProject = vi.fn(() => of(completed));
  const downloadDeploymentSql = vi.fn(() => of('INSERT INTO customers VALUES (1);'));
  const downloadText = vi.fn();

  beforeEach(async () => {
    deployProject.mockClear();
    downloadDeploymentSql.mockClear();
    downloadText.mockClear();

    await TestBed.configureTestingModule({
      imports: [ProjectDeploymentComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectId: '10' }) } } },
        {
          provide: DesignApiService,
          useValue: {
            getDesign: vi.fn(() => of(design)),
            getSchemaSql: vi.fn(() => of({ designId: 2, revision: 4, sql: 'CREATE TABLE customers (id INTEGER);' })),
            getDeploymentHistory: vi.fn(() => of([])),
            deployProject,
            downloadDeploymentSql,
            isRevisionConflict: vi.fn(() => false),
          },
        },
        { provide: FileDownloadService, useValue: { downloadText } },
        { provide: WorkflowStateService, useValue: { setProjectId: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('displays the actual deployment summary returned by the backend', () => {
    const fixture = TestBed.createComponent(ProjectDeploymentComponent);
    fixture.detectChanges();

    fixture.componentInstance.deploy();
    fixture.detectChanges();

    expect(deployProject).toHaveBeenCalledWith(10, 4);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Deployment Completed');
    expect(text).toContain('Tables created');
    expect(text).toContain('Rows seeded');
    expect(text).toContain('12');
    expect(text).toContain('Relationships');
    expect(text).toContain('Failed rows');
  });

  it('prevents repeated deployment submissions while a request is active', () => {
    const pending = new Subject<DeploymentResponse>();
    deployProject.mockReturnValueOnce(pending);
    const fixture = TestBed.createComponent(ProjectDeploymentComponent);
    fixture.detectChanges();

    fixture.componentInstance.deploy();
    fixture.componentInstance.deploy();

    expect(deployProject).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.deploying()).toBe(true);
    pending.next(completed);
    pending.complete();
    expect(fixture.componentInstance.deploying()).toBe(false);
  });

  it('downloads persisted deployment SQL from the backend endpoint', () => {
    const fixture = TestBed.createComponent(ProjectDeploymentComponent);
    fixture.detectChanges();
    fixture.componentInstance.deploy();

    fixture.componentInstance.downloadDeploymentFile('seed.sql');

    expect(downloadDeploymentSql).toHaveBeenCalledWith(10, 91, 'seed.sql');
    expect(downloadText).toHaveBeenCalledWith('seed.sql', 'INSERT INTO customers VALUES (1);', 'application/sql;charset=utf-8');
  });
});
