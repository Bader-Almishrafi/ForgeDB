import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, HostListener, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { combineLatest, filter } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ProjectWorkflowContextService } from '../services/project-workflow-context.service';
import { isWorkflowStepAllowed, PROJECT_WORKFLOW_STEPS, ProjectWorkflowStep, ProjectWorkflowStepDefinition } from '../services/project-workflow.guard';
import { ThemeService } from '../services/theme.service';

@Component({
  selector: 'app-project-workflow-shell',
  standalone: true,
  imports: [NgClass, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './project-workflow-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectWorkflowShellComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly themeService = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly context = inject(ProjectWorkflowContextService);
  readonly sidebarOpen = signal(false);
  readonly sidebarCollapsed = signal(false);
  readonly currentUrl = signal(this.router.url);
  readonly user = this.auth.user;
  readonly theme = this.themeService.theme;
  readonly steps = PROJECT_WORKFLOW_STEPS;
  readonly projectName = computed(() => this.context.workflow()?.projectName ?? '');
  readonly pageTitle = computed(() => {
    const path = this.currentUrl().split('?')[0].split('/').at(-1) as ProjectWorkflowStep | undefined;
    return PROJECT_WORKFLOW_STEPS.find((step) => step.path === path)?.label ?? this.context.workflow()?.currentStep ?? 'Project';
  });
  readonly displayName = computed(() => {
    const current = this.user();
    return current ? `${current.firstName} ${current.lastName}`.trim() : 'ForgeDB user';
  });
  readonly stepIcons: Record<ProjectWorkflowStep, string> = {
    data: 'M4 6h16v5H4V6Zm0 7h16v5H4v-5Zm3-4h.01M7 16h.01',
    analyze: 'M4 19V9m5 10V5m5 14v-7m5 7V3',
    clean: 'm4 20 5-5m0 0 8-8 2 2-8 8m-2-2-4-4m9-6 2-2',
    schema: 'M4 5h6v6H4V5Zm10 0h6v6H14V5ZM4 15h6v4H4v-4Zm10 0h6v4h-6v-4Z',
    'export-deploy': 'M12 3v12m0 0 4-4m-4 4-4-4M5 17v4h14v-4',
  };

  readonly enrichedSteps = computed(() => {
    const workflow = this.context.workflow();
    return this.steps.map((step) => ({
      ...step,
      allowed: workflow ? isWorkflowStepAllowed(workflow, step.path) : false,
    }));
  });

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.currentUrl.set(event.urlAfterRedirects);
        this.sidebarOpen.set(false);
      });
  }

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, query]) => {
        const projectId = Number(params.get('projectId'));
        const validProjectId = Number.isInteger(projectId) && projectId > 0 ? projectId : 0;
        const queryDataset = Number(query.get('datasetId'));
        const datasetId = Number.isInteger(queryDataset) && queryDataset > 0 ? queryDataset : null;
        this.context.load(validProjectId).subscribe();
        this.context.setDatasetFromQuery(datasetId);
      });
  }



  readonly disabledReason = computed(() => {
    return this.context.workflow()?.blockingReasons[0] ?? 'Complete the current workflow step first.';
  });

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  toggleCollapsed(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  retry(): void {
    const projectId = this.context.projectId();
    if (projectId) this.context.load(projectId, true).subscribe();
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  logout(): void {
    this.context.clear();
    this.auth.logout();
    void this.router.navigate(['/']);
  }

  readonly initials = computed(() => {
    const current = this.user();
    return current ? `${current.firstName[0] ?? ''}${current.lastName[0] ?? ''}`.toUpperCase() : 'FD';
  });

  @HostListener('document:keydown.escape')
  closeSidebarOnEscape(): void {
    this.sidebarOpen.set(false);
  }
}
