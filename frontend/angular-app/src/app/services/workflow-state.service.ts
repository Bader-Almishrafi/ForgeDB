import { computed, Injectable, signal } from '@angular/core';
import { DatasetResponse, ProjectResponse } from './api.models';

const projectIdKey = 'forgedb.currentProjectId';
const projectNameKey = 'forgedb.currentProjectName';
const datasetIdKey = 'forgedb.currentDatasetId';
const datasetNameKey = 'forgedb.currentDatasetName';
const datasetStatusKey = 'forgedb.currentDatasetStatus';

@Injectable({ providedIn: 'root' })
// Stores the currently selected project and dataset across routed pages. Signals update the live
// UI, while localStorage restores context after refresh so navigation can rebuild project URLs.
export class WorkflowStateService {
  private readonly projectIdSignal = signal<number | null>(this.readNumber(projectIdKey));
  private readonly projectNameSignal = signal<string | null>(this.readString(projectNameKey));
  private readonly datasetIdSignal = signal<number | null>(this.readNumber(datasetIdKey));
  private readonly datasetNameSignal = signal<string | null>(this.readString(datasetNameKey));
  private readonly datasetStatusSignal = signal<string | null>(this.readString(datasetStatusKey));

  readonly projectId = this.projectIdSignal.asReadonly();
  readonly projectName = this.projectNameSignal.asReadonly();
  readonly datasetId = this.datasetIdSignal.asReadonly();
  readonly datasetName = this.datasetNameSignal.asReadonly();
  readonly datasetStatus = this.datasetStatusSignal.asReadonly();

  readonly hasProject = computed(() => this.projectIdSignal() !== null);
  readonly hasDataset = computed(() => this.datasetIdSignal() !== null);

  // Saves the project returned by the API as the active cross-page context.
  setProject(project: ProjectResponse): void {
    this.setNumber(projectIdKey, project.id, this.projectIdSignal);
    this.setString(projectNameKey, project.name, this.projectNameSignal);
  }

  // Supports pages that know only an ID while optionally refreshing the displayed project name.
  setProjectId(projectId: number, projectName?: string): void {
    this.setNumber(projectIdKey, projectId, this.projectIdSignal);
    if (projectName) {
      this.setString(projectNameKey, projectName, this.projectNameSignal);
    }
  }

  // Records the imported or selected dataset so analysis and cleaning routes share one context.
  setDataset(dataset: DatasetResponse | { id: number; tableName: string; status?: string | null }): void {
    this.setNumber(datasetIdKey, dataset.id, this.datasetIdSignal);
    this.setString(datasetNameKey, dataset.tableName, this.datasetNameSignal);
    if ('status' in dataset && dataset.status) {
      this.setString(datasetStatusKey, dataset.status, this.datasetStatusSignal);
    }
  }

  // Updates dataset context from route/API data when a full DatasetResponse is not available.
  setDatasetId(datasetId: number, datasetName?: string, datasetStatus?: string): void {
    this.setNumber(datasetIdKey, datasetId, this.datasetIdSignal);
    if (datasetName) {
      this.setString(datasetNameKey, datasetName, this.datasetNameSignal);
    }
    if (datasetStatus) {
      this.setString(datasetStatusKey, datasetStatus, this.datasetStatusSignal);
    }
  }

  // Removes dataset context without discarding the surrounding selected project.
  clearDataset(): void {
    this.clearKey(datasetIdKey, this.datasetIdSignal);
    this.clearKey(datasetNameKey, this.datasetNameSignal);
    this.clearKey(datasetStatusKey, this.datasetStatusSignal);
  }

  // Clears both levels when authentication changes or the workflow is intentionally reset.
  clearAll(): void {
    this.clearKey(projectIdKey, this.projectIdSignal);
    this.clearKey(projectNameKey, this.projectNameSignal);
    this.clearDataset();
  }

  // Parses persisted numeric IDs defensively so invalid localStorage cannot become route state.
  private readNumber(key: string): number | null {
    const value = localStorage.getItem(key);
    if (!value) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  // Ignores missing and whitespace-only persisted labels.
  private readString(key: string): string | null {
    const value = localStorage.getItem(key);
    return value && value.trim() ? value : null;
  }

  // Keeps localStorage and the corresponding live Signal synchronized.
  private setNumber(key: string, value: number, target: { set(value: number | null): void }): void {
    localStorage.setItem(key, String(value));
    target.set(value);
  }

  // Persists a label and immediately publishes it to Signal consumers.
  private setString(key: string, value: string, target: { set(value: string | null): void }): void {
    localStorage.setItem(key, value);
    target.set(value);
  }

  // Clears persistent and reactive copies together to avoid stale cross-page context.
  private clearKey<T>(key: string, target: { set(value: T | null): void }): void {
    localStorage.removeItem(key);
    target.set(null);
  }
}
