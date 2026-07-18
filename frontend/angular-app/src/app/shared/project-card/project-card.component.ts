import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
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
// Presents one project and owns its edit/delete overlays. Successful mutations are emitted to
// ProjectsComponent, which remains responsible for the parent collection and page navigation.
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

  // Copies the current input into editable fields so canceling does not mutate parent data.
  startEdit(): void {
    this.editName = this.project().name;
    this.editDescription = this.project().description ?? '';
    this.errorMessage.set('');
    this.editing.set(true);
  }

  // Closes the editor and discards its transient error state.
  cancelEdit(): void {
    this.editing.set(false);
    this.errorMessage.set('');
  }

  // Sends editable fields through the API and emits the returned ProjectResponse so the parent
  // can replace its local card. saving prevents duplicate update requests.
  saveEdit(): void {
    const name = this.editName.trim();
    if (!name || this.saving()) {
      return;
    }

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

  // Opens a destructive-action confirmation instead of deleting immediately.
  confirmDelete(): void {
    this.errorMessage.set('');
    this.confirmingDelete.set(true);
  }

  // Closes the delete confirmation without changing the project.
  cancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  // Deletes through the API, emits the removed ID on success, and keeps failure feedback local
  // to the card. deleting prevents duplicate DELETE requests.
  deleteProject(): void {
    if (this.deleting()) {
      return;
    }

    const projectId = this.project().id;
    this.deleting.set(true);
    this.errorMessage.set('');
    this.api.deleteProject(projectId)
      .pipe(finalize(() => this.deleting.set(false)))
      .subscribe({
        next: () => this.projectDeleted.emit(projectId),
        error: (error: unknown) => {
          this.confirmingDelete.set(false);
          this.errorMessage.set(this.errorText(error, 'Unable to delete the project.'));
        },
      });
  }

  // Prefers the backend's structured JSON error while retaining a stable fallback for other failures.
  private errorText(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }
}
