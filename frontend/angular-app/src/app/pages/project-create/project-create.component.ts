import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody } from '../../services/api.models';
import { AuthService } from '../../services/auth.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-project-create',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './project-create.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCreateComponent {
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  projectName = '';
  projectDescription = '';

  constructor(
    private readonly api: ForgeApiService,
    private readonly auth: AuthService,
    private readonly workflow: WorkflowStateService,
    private readonly router: Router,
  ) {}

  createProject(): void {
    const userId = this.auth.userId();
    const name = this.projectName.trim();
    if (userId === null || !name || this.saving()) {
      return;
    }

    this.errorMessage.set('');
    this.saving.set(true);
    this.api.createProject({
      userId,
      name,
      description: this.projectDescription.trim() || null,
    }).pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (project) => {
          this.workflow.setProject(project);
          this.router.navigate(['/projects', project.id, 'overview']);
        },
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage.set(error.error?.message ?? 'Unable to create project. Please try again.');
        },
      });
  }
}
