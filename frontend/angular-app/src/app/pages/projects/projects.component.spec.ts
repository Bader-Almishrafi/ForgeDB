import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { ProjectsComponent } from './projects.component';

const projects: ProjectResponse[] = [
  {
    id: 1, name: 'Zulu', description: 'Later', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
    workflowState: 'NeedsAnalysis', currentStep: 'Analyze', recommendedRoute: '/projects/1/analyze', datasetsCount: 2,
  },
  {
    id: 2, name: 'Alpha', description: null, createdAt: '2026-05-01T00:00:00Z', updatedAt: null,
    workflowState: 'NoData', currentStep: 'Data', recommendedRoute: '/projects/2/data', datasetsCount: 0,
  },
];

describe('ProjectsComponent', () => {
  let fixture: ComponentFixture<ProjectsComponent>;
  let component: ProjectsComponent;
  let getProjects: ReturnType<typeof vi.fn>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let router: Router;

  beforeEach(async () => {
    getProjects = vi.fn(() => of(projects));
    query = new BehaviorSubject(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [ProjectsComponent],
      providers: [
        provideRouter([]),
        { provide: ForgeApiService, useValue: { getProjects, updateProject: vi.fn(), deleteProject: vi.fn() } },
        { provide: ActivatedRoute, useValue: { queryParamMap: query.asObservable() } },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(ProjectsComponent);
    component = fixture.componentInstance;
  });

  it('loads the authenticated project list with loading state', () => {
    const pending = new Subject<ProjectResponse[]>();
    getProjects.mockReturnValue(pending);
    fixture.detectChanges();

    expect(getProjects).toHaveBeenCalledOnce();
    expect(component.loading()).toBe(true);
    expect(fixture.nativeElement.querySelector('[aria-label="Loading projects"]')).toBeTruthy();

    pending.next(projects);
    pending.complete();
    fixture.detectChanges();
    expect(component.projects()).toEqual(projects);
  });

  it('searches by project name and sorts by name or date', () => {
    fixture.detectChanges();
    component.updateSearch('alp');
    expect(component.filteredProjects().map((project) => project.name)).toEqual(['Alpha']);

    component.clearSearch();
    component.updateSort('name');
    expect(component.filteredProjects().map((project) => project.name)).toEqual(['Alpha', 'Zulu']);
    component.updateSort('modified');
    expect(component.filteredProjects().map((project) => project.name)).toEqual(['Zulu', 'Alpha']);
  });

  it('opens a project using the backend recommendedRoute', () => {
    fixture.detectChanges();
    component.openProject(projects[0]);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/projects/1/analyze');
  });

  it('shows empty and no-search-result states', () => {
    fixture.detectChanges();
    component.projects.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('You do not have any projects yet');

    component.projects.set(projects);
    component.updateSearch('missing');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No projects match');
  });

  it('shows an API error and retry action', () => {
    fixture.detectChanges();
    getProjects.mockReturnValue(throwError(() => ({ error: { message: 'Project service unavailable.' } })));
    component.loadProjects();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Project service unavailable.');
    expect(fixture.nativeElement.textContent).toContain('Try again');
  });
});
