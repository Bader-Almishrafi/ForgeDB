import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, HostListener, inject, signal, OnInit } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ForgeApiService } from '../../services/forge-api.service';
import { UnsavedChangesAware } from '../../services/unsaved-changes.guard';

const PROJECT_NAME_MAX_LENGTH = 100;
const PROJECT_DESCRIPTION_MAX_LENGTH = 500;

function trimmedRequired(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.trim() ? null : { whitespace: true };
}

@Component({
  selector: 'app-project-create',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './project-create.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCreateComponent implements UnsavedChangesAware, OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly api = inject(ForgeApiService);
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private allowNavigation = false;

  readonly submitting = signal(false);
  readonly errorMessage = signal('');
  readonly projectForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(PROJECT_NAME_MAX_LENGTH), trimmedRequired]],
    description: ['', Validators.maxLength(PROJECT_DESCRIPTION_MAX_LENGTH)],
  });

  ngOnInit(): void {
    this.titleService.setTitle('Create Project - ForgeDB');
    this.metaService.updateTag({ name: 'description', content: 'Create a new ForgeDB project workspace.' });
  }

  createProject(): void {
    if (this.submitting()) return;
    this.projectForm.markAllAsTouched();
    if (this.projectForm.invalid) return;

    const value = this.projectForm.getRawValue();
    this.submitting.set(true);
    this.errorMessage.set('');
    this.api.createProject({
      name: value.name.trim(),
      description: value.description.trim() || null,
    }).pipe(finalize(() => this.submitting.set(false))).subscribe({
      next: (project) => {
        this.allowNavigation = true;
        this.projectForm.markAsPristine();
        void this.router.navigate(['/projects', project.id, 'data']);
      },
      error: (error: unknown) => this.errorMessage.set(this.errorText(error)),
    });
  }

  canDeactivate(): boolean {
    if (this.allowNavigation || !this.projectForm.dirty) return true;
    if (this.submitting()) return false;
    return window.confirm('Leave without creating this project? Your changes will be lost.');
  }

  @HostListener('window:beforeunload', ['$event'])
  protectBrowserUnload(event: BeforeUnloadEvent): void {
    if (!this.allowNavigation && this.projectForm.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  private errorText(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'message' in error.error) {
      const message = (error.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return 'Unable to create the project. Please try again.';
  }
}
