import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { Params, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { WorkflowStateService } from '../services/workflow-state.service';

interface NavItem {
  label: string;
  route: string;
  icon: string;
}

interface WorkflowStep {
  label: string;
  helper: string;
  route: () => string | null;
  queryParams?: () => Params | null;
  enabled: () => boolean;
  completed: () => boolean;
  match: (url: string) => boolean;
}

type StepState = 'locked' | 'available' | 'current' | 'completed';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgClass],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  readonly sidebarOpen = signal(false);
  readonly dropdownOpen = signal(false);
  readonly user = this.authService.user;
  readonly isLoggedIn = this.authService.isLoggedIn;
  readonly projectId = this.workflow.projectId;
  readonly projectName = this.workflow.projectName;
  readonly datasetId = this.workflow.datasetId;
  readonly datasetName = this.workflow.datasetName;
  readonly datasetStatus = this.workflow.datasetStatus;
  readonly schemaId = this.workflow.schemaId;
  readonly schemaName = this.workflow.schemaName;

  readonly navItems: NavItem[] = [
    { label: 'Projects', route: '/projects', icon: 'M3.75 6.75h5.19l1.06 1.5h10.25v9.75a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V6.75Z' },
  ];

  readonly workflowSteps: WorkflowStep[] = [
    {
      label: 'Project',
      helper: 'Project hub',
      route: () => this.projectId() ? `/projects/${this.projectId()}/workspace` : '/projects',
      enabled: () => true,
      completed: () => this.projectId() !== null,
      match: (url) => url === '/projects' || url.includes('/workspace'),
    },
    {
      label: 'Upload',
      helper: 'CSV import',
      route: () => this.projectId() ? `/projects/${this.projectId()}/upload` : null,
      enabled: () => this.projectId() !== null,
      completed: () => this.datasetId() !== null,
      match: (url) => url.includes('/upload'),
    },
    {
      label: 'Preview',
      helper: 'Validate rows',
      route: () => this.datasetId() ? `/datasets/${this.datasetId()}/preview` : null,
      enabled: () => this.datasetId() !== null,
      completed: () => this.datasetId() !== null,
      match: (url) => url.includes('/preview'),
    },
    {
      label: 'Analyze',
      helper: 'Profile data',
      route: () => this.datasetId() ? `/datasets/${this.datasetId()}/analyze` : null,
      enabled: () => this.datasetId() !== null,
      completed: () => this.datasetStatus() === 'Analyzed',
      match: (url) => url.includes('/analyze'),
    },
    {
      label: 'Dashboard',
      helper: 'Metrics',
      route: () => this.datasetId() ? `/datasets/${this.datasetId()}/dashboard` : null,
      enabled: () => this.datasetId() !== null,
      completed: () => this.datasetStatus() === 'Analyzed',
      match: (url) => url.includes('/dashboard'),
    },
    {
      label: 'Schema',
      helper: 'SQL review',
      route: () => this.datasetId() ? `/datasets/${this.datasetId()}/schema` : null,
      enabled: () => this.datasetId() !== null,
      completed: () => this.schemaId() !== null,
      match: (url) => url.includes('/schema') && !url.includes('tab=er'),
    },
    {
      label: 'ER Diagram',
      helper: 'Visual model',
      route: () => this.datasetId() ? `/datasets/${this.datasetId()}/schema` : null,
      queryParams: () => ({ tab: 'er', schemaId: this.schemaId() }),
      enabled: () => this.schemaId() !== null,
      completed: () => this.schemaId() !== null,
      match: (url) => url.includes('/schema') && url.includes('tab=er'),
    },
    {
      label: 'Relationships',
      helper: 'Manual links',
      route: () => this.schemaId() ? `/schemas/${this.schemaId()}/relationships` : null,
      enabled: () => this.schemaId() !== null,
      completed: () => this.schemaId() !== null,
      match: (url) => url.includes('/relationships'),
    },
    {
      label: 'Deployment',
      helper: 'Final SQL',
      route: () => this.schemaId() ? `/schemas/${this.schemaId()}/deploy` : null,
      enabled: () => this.schemaId() !== null,
      completed: () => false,
      match: (url) => url.includes('/deploy'),
    },
  ];

  constructor(
    private router: Router,
    private authService: AuthService,
    private workflow: WorkflowStateService,
  ) {}

  toggleDropdown(): void {
    this.dropdownOpen.update((value) => !value);
  }

  logout(): void {
    this.dropdownOpen.set(false);
    this.authService.logout();
    this.workflow.clearAll();
    this.router.navigate(['/']);
  }

  initials(): string {
    const currentUser = this.user();
    if (!currentUser) {
      return 'FD';
    }

    return `${currentUser.firstName[0] ?? ''}${currentUser.lastName[0] ?? ''}`.toUpperCase();
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((value) => !value);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  stepState(step: WorkflowStep): StepState {
    if (!step.enabled()) {
      return 'locked';
    }

    if (step.match(this.router.url)) {
      return 'current';
    }

    return step.completed() ? 'completed' : 'available';
  }

  stepClasses(step: WorkflowStep): string {
    const state = this.stepState(step);

    if (state === 'current') {
      return 'border-indigo-300 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-100';
    }

    if (state === 'completed') {
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    }

    if (state === 'locked') {
      return 'border-slate-200 bg-slate-50 text-slate-400';
    }

    return 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/60';
  }

  nextActionLabel(): string {
    const activeStep = this.workflowSteps.find((step) => this.stepState(step) === 'available')
      ?? this.workflowSteps.find((step) => this.stepState(step) === 'current')
      ?? this.workflowSteps.find((step) => this.stepState(step) === 'locked');

    return activeStep ? activeStep.label : 'Database package';
  }
}
