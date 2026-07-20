import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, HostListener, inject, OnInit, signal } from '@angular/core';
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
  readonly accountOpen = signal(false);
  readonly mobileSidebarOpen = signal(false);
  readonly sidebarCollapsed = signal(false);
  readonly user = this.auth.user;
  readonly theme = this.themeService.theme;
  readonly steps = PROJECT_WORKFLOW_STEPS;
  readonly projectName = computed(() => this.context.workflow()?.projectName ?? '');
  readonly nextStep = computed(() => this.context.workflow()?.nextStep ?? null);
  readonly displayName = computed(() => {
    const current = this.user();
    return current ? `${current.firstName} ${current.lastName}`.trim() : 'ForgeDB user';
  });
  readonly stepIcons: Record<ProjectWorkflowStep, string> = {
    data: 'M4 6h16v5H4V6Zm0 7h16v5H4v-5Zm3-4h.01M7 16h.01',
    analyze: 'M4 19V9m5 10V5m5 14v-7m5 7V3',
    clean: 'm4 20 5-5m0 0 8-8 2 2-8 8m-2-2-4-4m9-6 2-2',
    schema: 'M4 5h6v6H4V5Zm10 0h6v6h-6V5ZM4 15h6v4H4v-4Zm10 0h6v4h-6v-4Z',
    'export-deploy': 'M12 3v12m0 0 4-4m-4 4-4-4M5 17v4h14v-4',
  };

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.mobileSidebarOpen.set(false);
        this.accountOpen.set(false);
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

  isAllowed(step: ProjectWorkflowStepDefinition): boolean {
    const workflow = this.context.workflow();
    return workflow ? isWorkflowStepAllowed(workflow, step.path) : false;
  }

  disabledReason(): string {
    return this.context.workflow()?.blockingReasons[0] ?? 'Complete the current workflow step first.';
  }

  toggleDesktopSidebar(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  toggleMobileSidebar(): void {
    this.mobileSidebarOpen.update((open) => !open);
  }

  closeMobileSidebar(): void {
    this.mobileSidebarOpen.set(false);
  }

  retry(): void {
    const projectId = this.context.projectId();
    if (projectId) this.context.load(projectId, true).subscribe();
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  logout(): void {
    this.accountOpen.set(false);
    this.context.clear();
    this.auth.logout();
    void this.router.navigate(['/']);
  }

  initials(): string {
    const current = this.user();
    return current ? `${current.firstName[0] ?? ''}${current.lastName[0] ?? ''}`.toUpperCase() : 'FD';
  }

  @HostListener('document:keydown.escape')
  closeOverlaysOnEscape(): void {
    this.accountOpen.set(false);
    this.mobileSidebarOpen.set(false);
  }
}
