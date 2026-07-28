import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { combineLatest, filter } from 'rxjs';
import { ProjectWorkflow } from '../services/api.models';
import { ProjectWorkflowContextService } from '../services/project-workflow-context.service';
import {
  isWorkflowStepAllowed,
  PROJECT_WORKFLOW_STEPS,
  ProjectWorkflowStep,
  ProjectWorkflowStepDefinition,
} from '../services/project-workflow.guard';

type WorkflowProgressState = 'complete' | 'current' | 'available' | 'blocked' | 'needs-attention';

interface WorkflowProgressStep extends ProjectWorkflowStepDefinition {
  index: number;
  allowed: boolean;
  active: boolean;
  state: WorkflowProgressState;
  stateLabel: string;
}

interface WorkflowGuidance {
  title: string;
  message: string;
  targetPath: ProjectWorkflowStep | null;
  targetLabel: string | null;
  positive: boolean;
}

@Component({
  selector: 'app-project-workflow-shell',
  standalone: true,
  imports: [NgClass, RouterLink, RouterOutlet],
  templateUrl: './project-workflow-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectWorkflowShellComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly context = inject(ProjectWorkflowContextService);
  readonly currentUrl = signal(this.router.url);
  readonly steps = PROJECT_WORKFLOW_STEPS;
  readonly projectName = computed(() => this.context.workflow()?.projectName ?? '');
  readonly activeStepPath = computed<ProjectWorkflowStep | null>(() => {
    const path = this.currentUrl().split('?')[0].split('/').filter(Boolean).at(-1);
    return this.isStepPath(path) ? path : null;
  });
  readonly pageTitle = computed(() => {
    const active = this.activeStepPath();
    return this.steps.find((step) => step.path === active)?.label ?? 'Project workflow';
  });
  readonly progressSteps = computed<WorkflowProgressStep[]>(() => {
    const workflow = this.context.workflow();
    if (!workflow) return this.steps.map((step, index) => ({
      ...step,
      index,
      allowed: false,
      active: false,
      state: 'blocked',
      stateLabel: 'Blocked',
    }));

    const recommended = this.recommendedStep(workflow);
    const recommendedIndex = recommended
      ? this.steps.findIndex((step) => step.path === recommended)
      : -1;
    const active = this.activeStepPath() ?? recommended;
    const attention = this.attentionStep(workflow);

    return this.steps.map((step, index) => {
      const allowed = isWorkflowStepAllowed(workflow, step.path);
      const isActive = active === step.path;
      let state: WorkflowProgressState;

      if (attention === step.path) state = 'needs-attention';
      else if (isActive && allowed) state = 'current';
      else if (allowed && recommendedIndex >= 0 && index < recommendedIndex) state = 'complete';
      else if (allowed) state = 'available';
      else state = 'blocked';

      return {
        ...step,
        index,
        allowed,
        active: isActive,
        state,
        stateLabel: state === 'needs-attention' && isActive
          ? 'Current · Needs attention'
          : this.stateLabel(state),
      };
    });
  });
  readonly guidance = computed<WorkflowGuidance>(() => {
    const workflow = this.context.workflow();
    if (!workflow) {
      return {
        title: 'Project workflow',
        message: 'Loading the next recommended action.',
        targetPath: null,
        targetLabel: null,
        positive: false,
      };
    }

    const blocker = this.plainLanguageBlocker(workflow);
    const targetPath = this.attentionStep(workflow) ?? this.recommendedStep(workflow);
    const target = this.steps.find((step) => step.path === targetPath) ?? null;
    if (blocker) {
      return {
        title: 'Next action',
        message: blocker,
        targetPath: target && isWorkflowStepAllowed(workflow, target.path) ? target.path : null,
        targetLabel: target?.label ?? null,
        positive: false,
      };
    }

    if (workflow.latestDeploymentStatus?.toLocaleLowerCase() === 'failed') {
      return {
        title: 'Deployment needs attention',
        message: 'The latest deployment failed. Review its details, correct the connection or schema issue, then retry.',
        targetPath: 'export-deploy',
        targetLabel: 'Export and Deploy',
        positive: false,
      };
    }

    if (workflow.canDeploy) {
      return {
        title: 'Ready to deploy',
        message: 'Your validated schema and current data versions are ready for deployment.',
        targetPath: 'export-deploy',
        targetLabel: 'Export and Deploy',
        positive: true,
      };
    }

    if (workflow.canExport) {
      return {
        title: 'Ready to export',
        message: 'Your schema is validated. Review the generated files or deployment plan.',
        targetPath: 'export-deploy',
        targetLabel: 'Export and Deploy',
        positive: true,
      };
    }

    return {
      title: 'Continue the workflow',
      message: target ? `Continue with ${target.label}.` : 'Continue with the next available step.',
      targetPath: target && isWorkflowStepAllowed(workflow, target.path) ? target.path : null,
      targetLabel: target?.label ?? null,
      positive: true,
    };
  });

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => this.currentUrl.set(event.urlAfterRedirects));
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

  retry(): void {
    const projectId = this.context.projectId();
    if (projectId) this.context.load(projectId, true).subscribe();
  }

  blockedReason(step: WorkflowProgressStep): string {
    if (step.state === 'needs-attention') return this.guidance().message;
    const previous = step.index > 0 ? this.steps[step.index - 1] : null;
    return previous
      ? `Complete ${previous.label} before opening ${step.label}.`
      : 'Complete the current project action first.';
  }

  showGuidanceLink(guidance: WorkflowGuidance): boolean {
    return Boolean(guidance.targetPath && guidance.targetPath !== this.activeStepPath());
  }

  private recommendedStep(workflow: ProjectWorkflow): ProjectWorkflowStep | null {
    const routeStep = workflow.recommendedRoute.split('?')[0].split('/').filter(Boolean).at(-1);
    if (this.isStepPath(routeStep)) return routeStep;

    const normalized = workflow.currentStep.trim().toLocaleLowerCase().replaceAll('&', 'and');
    const aliases: Record<string, ProjectWorkflowStep> = {
      data: 'data',
      'data sources': 'data',
      analyze: 'analyze',
      analysis: 'analyze',
      clean: 'clean',
      'data cleaning': 'clean',
      schema: 'schema',
      'schema design': 'schema',
      'export and deploy': 'export-deploy',
      'export deploy': 'export-deploy',
    };
    return aliases[normalized] ?? null;
  }

  private attentionStep(workflow: ProjectWorkflow): ProjectWorkflowStep | null {
    const code = workflow.blockerCodes[0]?.toLocaleLowerCase() ?? '';
    if (code === 'no_data') return 'data';
    if (code.startsWith('analysis_')) return 'analyze';
    if (code === 'quality_confirmation_required') return 'clean';
    if (code.startsWith('schema_')) return 'schema';
    if (code.startsWith('deployment_')) return 'export-deploy';

    const schemaStatus = workflow.schemaStatus.toLocaleLowerCase();
    if (schemaStatus === 'invalid' || schemaStatus === 'stale') return 'schema';
    if (workflow.latestDeploymentStatus?.toLocaleLowerCase() === 'failed') return 'export-deploy';

    const recommended = this.recommendedStep(workflow);
    return recommended && !isWorkflowStepAllowed(workflow, recommended) ? recommended : null;
  }

  private plainLanguageBlocker(workflow: ProjectWorkflow): string {
    const code = workflow.blockerCodes[0]?.toLocaleLowerCase() ?? '';
    const messages: Record<string, string> = {
      no_data: 'Import at least one data source to begin this project.',
      analysis_required: 'Run analysis for every active data source before continuing.',
      analysis_stale: 'A data source changed. Run analysis again for its current version.',
      quality_confirmation_required: 'Review the cleaning results, then confirm data quality.',
      schema_required: 'Generate a schema from the confirmed data versions.',
      schema_invalid: 'Fix the schema issues and validate the schema before exporting.',
      schema_stale: 'Your data changed after the schema was generated. Regenerate and validate it.',
      deployment_in_progress: 'A deployment is already running. Wait for it to finish, then refresh.',
      deployment_not_ready: 'Review the deployment requirements before trying again.',
    };
    return messages[code] ?? workflow.blockingReasons[0] ?? '';
  }

  private stateLabel(state: WorkflowProgressState): string {
    if (state === 'needs-attention') return 'Needs attention';
    return state.charAt(0).toUpperCase() + state.slice(1);
  }

  private isStepPath(value: string | undefined): value is ProjectWorkflowStep {
    return this.steps.some((step) => step.path === value);
  }
}
