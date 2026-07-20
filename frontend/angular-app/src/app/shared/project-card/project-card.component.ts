import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { ProjectResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';

@Component({
  selector: 'app-project-card',
  standalone: true,
  imports: [DatePipe, FormsModule],
  templateUrl: './project-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCardComponent {
  private readonly api = inject(ForgeApiService);
  readonly project = input.required<ProjectResponse>();
  readonly openProject = output<ProjectResponse>();
  readonly projectUpdated = output<ProjectResponse>();
  readonly projectDeleted = output<number>();

  readonly relevantDate = computed(() => this.project().updatedAt || this.project().createdAt);
  readonly dateLabel = computed(() => this.project().updatedAt ? 'Last modified' : 'Created');
  readonly editing = signal(false);
  readonly confirmingDelete = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly errorMessage = signal('');
  editName = '';
  editDescription = '';

  startEdit(): void {
    this.editName = this.project().name;
    this.editDescription = this.project().description ?? '';
    this.errorMessage.set('');
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.errorMessage.set('');
  }

  saveEdit(): void {
    const name = this.editName.trim();
    if (!name || name.length > 100 || this.editDescription.length > 500 || this.saving()) return;
    this.saving.set(true);
    this.errorMessage.set('');
    this.api.updateProject(this.project().id, { name, description: this.editDescription.trim() || null })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (updated) => {
          this.editing.set(false);
          this.projectUpdated.emit(updated);
        },
        error: (error: unknown) => this.errorMessage.set(this.errorText(error, 'Unable to update the project.')),
      });
  }

  confirmDelete(): void {
    this.errorMessage.set('');
    this.confirmingDelete.set(true);
  }

  cancelDelete(): void {
    if (!this.deleting()) this.confirmingDelete.set(false);
  }

  deleteProject(): void {
    if (this.deleting()) return;
    const projectId = this.project().id;
    this.deleting.set(true);
    this.errorMessage.set('');
    this.api.deleteProject(projectId).pipe(finalize(() => this.deleting.set(false))).subscribe({
      next: () => this.projectDeleted.emit(projectId),
      error: (error: unknown) => {
        this.errorMessage.set(this.errorText(error, 'Unable to delete the project.'));
      },
    });
  }

  private errorText(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }
}
