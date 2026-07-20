import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectWorkflow } from '../services/api.models';
import { AuthService } from '../services/auth.service';
import { ForgeApiService } from '../services/forge-api.service';
import { ProjectWorkflowContextService } from '../services/project-workflow-context.service';
import { ThemeService } from '../services/theme.service';
import { ProjectWorkflowShellComponent } from './project-workflow-shell.component';

function workflow(projectId: number): ProjectWorkflow {
  return {
    projectId,
    projectName: projectId === 10 ? 'Route project' : 'Second project',
    workflowState: 'NeedsAnalysis',
    currentStep: 'Analyze',
    nextStep: 'Clean',
    recommendedRoute: `/projects/${projectId}/analyze`,
    canImport: true,
    canAnalyze: true,
    canClean: false,
    canBuildSchema: false,
    canExport: false,
    canDeploy: false,
    blockerCodes: ['analysis_required'],
    blockingReasons: ['Analyze every active dataset version first.'],
    datasets: [],
    schemaStatus: 'None',
  };
}

describe('ProjectWorkflowShellComponent', () => {
  let fixture: ComponentFixture<ProjectWorkflowShellComponent>;
  let params: BehaviorSubject<ParamMap>;
  let query: BehaviorSubject<ParamMap>;
  const getProjectWorkflow = vi.fn((projectId: number) => of(workflow(projectId)));

  beforeEach(async () => {
    localStorage.setItem('forgedb.currentProjectId', '999');
    localStorage.setItem('forgedb.currentProjectName', 'Stored project');
    localStorage.setItem('forgedb.currentDatasetId', '888');
    params = new BehaviorSubject(convertToParamMap({ projectId: '10' }));
    query = new BehaviorSubject(convertToParamMap({ datasetId: '42' }));
    getProjectWorkflow.mockClear();

    await TestBed.configureTestingModule({
      imports: [ProjectWorkflowShellComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: {
          paramMap: params.asObservable(),
          queryParamMap: query.asObservable(),
          snapshot: { paramMap: params.value, queryParamMap: query.value },
        } },
        { provide: ForgeApiService, useValue: { getProjectWorkflow } },
        { provide: AuthService, useValue: {
          user: signal({ id: 1, firstName: 'Test', lastName: 'User', email: 'test@example.com', role: 'user', createdAt: '' }).asReadonly(),
          logout: vi.fn(),
        } },
        { provide: ThemeService, useValue: { theme: signal<'light' | 'dark'>('light').asReadonly(), toggle: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectWorkflowShellComponent);
    fixture.detectChanges();
    fixture.detectChanges();
  });

  it('reconstructs project and dataset context from route/query plus the workflow API on refresh', () => {
    const context = TestBed.inject(ProjectWorkflowContextService);
    expect(getProjectWorkflow).toHaveBeenCalledWith(10);
    expect(context.projectId()).toBe(10);
    expect(context.datasetId()).toBe(42);
    expect(fixture.nativeElement.querySelector('[data-testid="current-project-name"]').textContent).toContain('Route project');
    expect(fixture.nativeElement.textContent).not.toContain('Stored project');
  });

  it('renders five top workflow steps and disables future steps from backend permissions', () => {
    const nav = fixture.nativeElement.querySelector('[data-testid="workflow-top-navigation"]') as HTMLElement;
    expect(nav).toBeTruthy();
    expect(nav.querySelectorAll('ol > li')).toHaveLength(5);
    expect(nav.textContent).toContain('Export & Deploy');
    expect(nav.querySelectorAll('ol button:disabled')).toHaveLength(3);
    expect((nav.querySelector('ol button:disabled') as HTMLButtonElement).title).toContain('Analyze every active dataset version first.');
  });

  it('uses top navigation and does not render the old workflow sidebar', () => {
    expect(fixture.nativeElement.querySelector('aside')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="workflow-top-navigation"]')).toBeTruthy();
  });

  it('clears the previous project name and selected dataset when project route parameters change', () => {
    const context = TestBed.inject(ProjectWorkflowContextService);
    params.next(convertToParamMap({ projectId: '11' }));
    query.next(convertToParamMap({}));
    fixture.detectChanges();

    expect(getProjectWorkflow).toHaveBeenCalledWith(11);
    expect(context.datasetId()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="current-project-name"]').textContent).toContain('Second project');
    expect(fixture.nativeElement.textContent).not.toContain('Route project');
  });
});
