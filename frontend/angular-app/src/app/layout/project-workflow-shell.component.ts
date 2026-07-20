import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { combineLatest } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ProjectWorkflowContextService } from '../services/project-workflow-context.service';
import { isWorkflowStepAllowed, PROJECT_WORKFLOW_STEPS, ProjectWorkflowStepDefinition } from '../services/project-workflow.guard';
import { ThemeService } from '../services/theme.service';

@Component({
  selector: 'app-project-workflow-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
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
  readonly user = this.auth.user;
  readonly theme = this.themeService.theme;
  readonly steps = PROJECT_WORKFLOW_STEPS;
  readonly projectName = computed(() => this.context.workflow()?.projectName ?? '');
  readonly nextStep = computed(() => this.context.workflow()?.nextStep ?? null);

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
}
