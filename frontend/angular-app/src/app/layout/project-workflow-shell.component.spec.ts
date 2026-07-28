import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectWorkflow } from '../services/api.models';
import { ForgeApiService } from '../services/forge-api.service';
import { ProjectWorkflowContextService } from '../services/project-workflow-context.service';
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
  let workflowOverrides: Partial<ProjectWorkflow>;
  const getProjectWorkflow = vi.fn((projectId: number) => of({
    ...workflow(projectId),
    ...workflowOverrides,
    projectId,
  }));

  beforeEach(async () => {
    localStorage.setItem('forgedb.currentProjectId', '999');
    localStorage.setItem('forgedb.currentProjectName', 'Stored project');
    localStorage.setItem('forgedb.currentDatasetId', '888');
    params = new BehaviorSubject(convertToParamMap({ projectId: '10' }));
    query = new BehaviorSubject(convertToParamMap({ datasetId: '42' }));
    workflowOverrides = {};
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

  it('renders an accessible five-step progress navigator using backend permissions', () => {
    const progress = fixture.nativeElement.querySelector('[data-testid="workflow-progress"]') as HTMLElement;
    const steps = Array.from(progress.querySelectorAll<HTMLElement>('[data-testid="workflow-step"]'));

    expect(progress.getAttribute('aria-label')).toBe('Project workflow progress');
    expect(steps).toHaveLength(5);
    expect(steps.map((step) => step.querySelector('strong')?.textContent?.trim())).toEqual([
      'Data Sources',
      'Analysis',
      'Data Cleaning',
      'Schema Design',
      'Export and Deploy',
    ]);
    expect(steps.map((step) => step.dataset['state'])).toEqual([
      'complete',
      'needs-attention',
      'blocked',
      'blocked',
      'blocked',
    ]);
    expect(progress.querySelectorAll('button:disabled')).toHaveLength(3);
    expect((progress.querySelector('[data-state="blocked"] button') as HTMLButtonElement).title)
      .toBe('Complete Analysis before opening Data Cleaning.');
  });

  it('leaves global application navigation to AppShell', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="workflow-progress"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="workflow-sidebar"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="app-sidebar"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="workflow-top-navigation"]')).toBeNull();
  });

  it('preserves the selected dataset on enabled workflow links', () => {
    const links = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="workflow-step"] a')) as HTMLAnchorElement[];
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.getAttribute('href')?.includes('datasetId=42'))).toBe(true);
  });

  it('shows a visible needs-attention state and a plain-language next action', () => {
    const attentionStep = fixture.nativeElement.querySelector('[data-state="needs-attention"]') as HTMLElement;
    const guidance = fixture.nativeElement.querySelector('[data-testid="workflow-guidance"]') as HTMLElement;

    expect(attentionStep.textContent).toContain('Current');
    expect(attentionStep.textContent).toContain('Needs attention');
    expect(guidance.textContent).toContain('Next action');
    expect(guidance.textContent).toContain('Run analysis for every active data source before continuing.');
    expect(fixture.nativeElement.textContent).not.toContain('NeedsAnalysis');
  });

  it('distinguishes current, complete, available, and blocked progress states', () => {
    workflowOverrides = {
      workflowState: 'NeedsCleaning',
      currentStep: 'Clean',
      nextStep: 'Schema',
      recommendedRoute: '/projects/10/clean',
      canClean: true,
      blockerCodes: [],
      blockingReasons: [],
    };
    TestBed.inject(ProjectWorkflowContextService).load(10, true).subscribe();
    fixture.componentInstance.currentUrl.set('/projects/10/data?datasetId=42');
    fixture.detectChanges();

    const progress = fixture.nativeElement.querySelector('[data-testid="workflow-progress"]') as HTMLElement;
    const states = Array.from(progress.querySelectorAll<HTMLElement>('[data-testid="workflow-step"]'))
      .map((step) => step.dataset['state']);
    expect(states).toEqual(['current', 'complete', 'available', 'blocked', 'blocked']);
    expect(progress.querySelector('[data-state="current"] a')?.getAttribute('aria-current')).toBe('step');
  });

  it('surfaces a failed deployment before otherwise-positive deployment readiness', () => {
    workflowOverrides = {
      workflowState: 'ReadyToDeploy',
      currentStep: 'Export and Deploy',
      nextStep: 'Export and Deploy',
      recommendedRoute: '/projects/10/export-deploy',
      canClean: true,
      canBuildSchema: true,
      canExport: true,
      canDeploy: true,
      blockerCodes: [],
      blockingReasons: [],
      schemaStatus: 'Valid',
      latestDeploymentStatus: 'Failed',
    };
    TestBed.inject(ProjectWorkflowContextService).load(10, true).subscribe();
    fixture.componentInstance.currentUrl.set('/projects/10/export-deploy');
    fixture.detectChanges();

    const guidance = fixture.nativeElement.querySelector('[data-testid="workflow-guidance"]') as HTMLElement;
    const attention = fixture.nativeElement.querySelector('[data-state="needs-attention"]') as HTMLElement;

    expect(guidance.textContent).toContain('Deployment needs attention');
    expect(guidance.textContent).toContain('The latest deployment failed.');
    expect(guidance.textContent).not.toContain('Ready to deploy');
    expect(attention.textContent).toContain('Needs attention');
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
