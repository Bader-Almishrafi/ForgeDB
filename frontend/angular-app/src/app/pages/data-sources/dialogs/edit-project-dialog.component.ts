import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, Output, signal, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ProjectResponse } from '../../../services/api.models';
import { ForgeApiService } from '../../../services/forge-api.service';

@Component({
  selector: 'app-edit-project-dialog',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './edit-project-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditProjectDialogComponent implements OnChanges {
  private readonly api = inject(ForgeApiService);

  @Input() isOpen = false;
  @Input() project: ProjectResponse | null = null;
  
  @Output() closeDialog = new EventEmitter<void>();
  @Output() saved = new EventEmitter<ProjectResponse>();

  readonly editName = signal('');
  readonly editDescription = signal('');
  readonly editError = signal('');
  readonly savingProject = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.project) {
      this.editName.set(this.project.name);
      this.editDescription.set(this.project.description ?? '');
      this.editError.set('');
    }
  }

  close(): void {
    if (!this.savingProject()) this.closeDialog.emit();
  }

  saveProject(): void {
    const name = this.editName().trim();
    if (!this.project || !name || name.length > 100 || this.editDescription().length > 500 || this.savingProject()) return;
    
    this.savingProject.set(true);
    this.editError.set('');
    
    this.api.updateProject(this.project.id, { name, description: this.editDescription().trim() || null })
      .pipe(finalize(() => this.savingProject.set(false)))
      .subscribe({
        next: (updated) => {
          this.saved.emit(updated);
        },
        error: (error: unknown) => this.editError.set(this.errorText(error, 'Unable to update this project.')),
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
