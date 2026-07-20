import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { catchError, finalize, Observable, of, shareReplay, tap } from 'rxjs';
import { ProjectWorkflow } from './api.models';
import { ForgeApiService } from './forge-api.service';

export type WorkflowLoadErrorKind = 'invalid' | 'not-found' | 'forbidden' | 'unavailable';

export interface WorkflowLoadError {
  kind: WorkflowLoadErrorKind;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ProjectWorkflowContextService {
  private readonly projectIdSignal = signal<number | null>(null);
  private readonly datasetIdSignal = signal<number | null>(null);
  private readonly workflowSignal = signal<ProjectWorkflow | null>(null);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<WorkflowLoadError | null>(null);
  private requestProjectId: number | null = null;
  private request$: Observable<ProjectWorkflow | null> | null = null;
  private loadVersion = 0;

  readonly projectId = this.projectIdSignal.asReadonly();
  readonly datasetId = this.datasetIdSignal.asReadonly();
  readonly workflow = this.workflowSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  constructor(private readonly api: ForgeApiService) {}

  setDatasetFromQuery(datasetId: number | null): void {
    this.datasetIdSignal.set(datasetId);
  }

  load(projectId: number, force = false): Observable<ProjectWorkflow | null> {
    if (!Number.isInteger(projectId) || projectId <= 0) {
      this.clear();
      this.errorSignal.set({ kind: 'invalid', message: 'Invalid project.' });
      return of(null);
    }

    if (!force && this.projectIdSignal() === projectId && this.workflowSignal()) {
      return of(this.workflowSignal());
    }
    if (!force && this.requestProjectId === projectId && this.request$) return this.request$;

    const version = ++this.loadVersion;
    const projectChanged = this.projectIdSignal() !== projectId;
    this.projectIdSignal.set(projectId);
    if (projectChanged) {
      this.datasetIdSignal.set(null);
      this.workflowSignal.set(null);
    }
    this.errorSignal.set(null);
    this.loadingSignal.set(projectChanged || this.workflowSignal() === null);
    this.requestProjectId = projectId;

    const request = this.api.getProjectWorkflow(projectId).pipe(
      tap((workflow) => {
        if (version !== this.loadVersion) return;
        this.workflowSignal.set(workflow);
        this.errorSignal.set(null);
      }),
      catchError((error: unknown) => {
        if (version === this.loadVersion) this.errorSignal.set(this.describeError(error));
        return of(null);
      }),
      finalize(() => {
        if (version !== this.loadVersion) return;
        this.loadingSignal.set(false);
        this.requestProjectId = null;
        this.request$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.request$ = request;
    return request;
  }

  clear(): void {
    this.loadVersion++;
    this.projectIdSignal.set(null);
    this.datasetIdSignal.set(null);
    this.workflowSignal.set(null);
    this.loadingSignal.set(false);
    this.errorSignal.set(null);
    this.requestProjectId = null;
    this.request$ = null;
  }

  private describeError(error: unknown): WorkflowLoadError {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) return { kind: 'not-found', message: 'Project not found.' };
      if (error.status === 403) return { kind: 'forbidden', message: 'You do not have access to this project.' };
      const bodyMessage = error.error && typeof error.error === 'object' && 'message' in error.error
        ? (error.error as { message?: unknown }).message
        : null;
      if (typeof bodyMessage === 'string' && bodyMessage.trim()) {
        return { kind: 'unavailable', message: bodyMessage };
      }
    }
    return { kind: 'unavailable', message: 'Project workflow could not be loaded. Please try again.' };
  }
}
