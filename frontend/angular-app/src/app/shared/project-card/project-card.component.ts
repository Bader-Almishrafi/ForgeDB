import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { ProjectResponse } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { DialogFocusTrapDirective } from '../dialog-focus-trap.directive';

@Component({
  selector: 'app-project-card',
  standalone: true,
  imports: [DatePipe, FormsModule, DialogFocusTrapDirective],
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
  readonly dateLabel = computed(() => this.project().updatedAt ? 'Last updated' : 'Created');
  readonly stepLabel = computed(() => this.friendlyStep(this.project().currentStep));
  readonly statusLabel = computed(() => this.friendlyStatus(this.project().workflowState));
  readonly statusClass = computed(() => {
    const state = this.project().workflowState;
    if (state === 'Deployed' || state === 'ReadyToDeploy' || state === 'SchemaValid') return 'badge-success';
    if (state === 'NeedsAnalysis' || state === 'NeedsReanalysis' || state === 'SchemaDraft') return 'badge-warning';
    return 'badge-neutral';
  });
  readonly menuOpen = signal(false);
  readonly editing = signal(false);
  readonly confirmingDelete = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly errorMessage = signal('');
  editName = '';
  editDescription = '';
  readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  readonly editNameInput = viewChild<ElementRef<HTMLInputElement>>('editNameInput');
  readonly deleteCancelButton = viewChild<ElementRef<HTMLButtonElement>>('deleteCancelButton');

  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  keepMenuOpen(event: MouseEvent): void {
    event.stopPropagation();
  }

  startEdit(): void {
    if (this.saving() || this.deleting()) return;
    this.editName = this.project().name;
    this.editDescription = this.project().description ?? '';
    this.errorMessage.set('');
    this.confirmingDelete.set(false);
    this.menuOpen.set(false);
    this.editing.set(true);
    window.setTimeout(() => this.editNameInput()?.nativeElement.focus());
  }

  cancelEdit(): void {
    if (this.saving()) return;
    this.editing.set(false);
    this.errorMessage.set('');
    this.restoreMenuFocus();
  }

  closeEditFromBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.cancelEdit();
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
          this.restoreMenuFocus();
        },
        error: (error: unknown) => this.errorMessage.set(this.errorText(error, 'Unable to update the project.')),
      });
  }

  confirmDelete(): void {
    if (this.saving() || this.deleting()) return;
    this.errorMessage.set('');
    this.editing.set(false);
    this.menuOpen.set(false);
    this.confirmingDelete.set(true);
    window.setTimeout(() => this.deleteCancelButton()?.nativeElement.focus());
  }

  cancelDelete(): void {
    if (this.deleting()) return;
    this.confirmingDelete.set(false);
    this.errorMessage.set('');
    this.restoreMenuFocus();
  }

  closeDeleteFromBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.cancelDelete();
  }

  deleteProject(): void {
    if (this.deleting()) return;
    const projectId = this.project().id;
    this.deleting.set(true);
    this.errorMessage.set('');
    this.api.deleteProject(projectId).pipe(finalize(() => this.deleting.set(false))).subscribe({
      next: () => {
        this.confirmingDelete.set(false);
        this.projectDeleted.emit(projectId);
      },
      error: (error: unknown) => {
        this.errorMessage.set(this.errorText(error, 'Unable to delete the project.'));
      },
    });
  }

  editValidationMessage(): string {
    if (!this.editName.trim()) return 'Project name is required.';
    if (this.editName.length > 100) return 'Project name must be 100 characters or fewer.';
    if (this.editDescription.length > 500) return 'Description must be 500 characters or fewer.';
    return '';
  }

  @HostListener('document:keydown.escape')
  closeDialogOnEscape(): void {
    if (this.menuOpen()) {
      this.menuOpen.set(false);
      this.restoreMenuFocus();
      return;
    }
    if (this.editing() && !this.saving()) this.cancelEdit();
    if (this.confirmingDelete() && !this.deleting()) this.cancelDelete();
  }

  @HostListener('document:click')
  closeMenu(): void {
    this.menuOpen.set(false);
  }

  private restoreMenuFocus(): void {
    window.setTimeout(() => this.menuButton()?.nativeElement.focus());
  }

  private friendlyStep(step: string): string {
    return ({
      Data: 'Data Sources',
      Analyze: 'Analysis',
      Clean: 'Data Cleaning',
      Schema: 'Schema Design',
      'Export & Deploy': 'Export and Deploy',
    } as Record<string, string>)[step] ?? step;
  }

  private friendlyStatus(status: string): string {
    return ({
      NoData: 'Needs data',
      NeedsAnalysis: 'Analysis needed',
      NeedsReanalysis: 'Re-analysis needed',
      Analyzed: 'Ready to clean',
      ReadyForSchema: 'Ready for schema',
      SchemaDraft: 'Schema needs validation',
      SchemaValid: 'Export ready',
      ReadyToDeploy: 'Ready to deploy',
      Deployed: 'Deployed',
    } as Record<string, string>)[status] ?? 'In progress';
  }

  private errorText(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  }
}
