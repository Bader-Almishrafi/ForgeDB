import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ProjectDeploymentComponent } from '../project-deployment/project-deployment.component';
import { ProjectExportsComponent } from '../project-exports/project-exports.component';

@Component({
  selector: 'app-export-deploy',
  standalone: true,
  imports: [ProjectExportsComponent, ProjectDeploymentComponent],
  template: `
    <div class="space-y-8" data-testid="export-deploy-page">
      <section aria-labelledby="exports-heading">
        <h1 id="exports-heading" class="sr-only">Export</h1>
        <app-project-exports />
      </section>
      <div class="border-t border-slate-200 dark:border-slate-800"></div>
      <section aria-labelledby="deployment-heading">
        <h2 id="deployment-heading" class="sr-only">Deployment</h2>
        <app-project-deployment />
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportDeployComponent {}
