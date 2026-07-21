import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthUser, ProjectResponse } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { HomeComponent } from './home.component';

const user: AuthUser = { id: 3, firstName: 'Mona', lastName: 'Ali', email: 'mona@example.com', role: 'user', createdAt: '2026-01-01T00:00:00Z' };
const projects: ProjectResponse[] = Array.from({ length: 5 }, (_, index) => ({
  id: index + 1,
  name: `Project ${index + 1}`,
  description: `Description ${index + 1}`,
  createdAt: `2026-01-0${index + 1}T00:00:00Z`,
  updatedAt: `2026-02-0${index + 1}T00:00:00Z`,
  workflowState: 'NeedsAnalysis',
  currentStep: 'Analyze',
  recommendedRoute: `/projects/${index + 1}/analyze`,
  datasetsCount: index + 1,
}));

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    api = {
      getProjects: vi.fn(() => of(projects)),
      getProjectWorkflow: vi.fn(() => of(null)),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { user: signal(user).asReadonly() } },
        { provide: ForgeApiService, useValue: api },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('loads authenticated recent projects and initially renders at most four cards', () => {
    expect(api['getProjects']).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Welcome back, Mona');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="project-card"]')).toHaveLength(4);
    expect(fixture.nativeElement.textContent).toContain('View all 5 projects');
    expect(fixture.nativeElement.querySelector('[data-testid="recent-activity"]')).toBeTruthy();
  });

  it('opens a recent project at the API-recommended workflow route', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.componentInstance.openProject(projects[0]);
    expect(navigate).toHaveBeenCalledWith('/projects/1/analyze');
  });
});
