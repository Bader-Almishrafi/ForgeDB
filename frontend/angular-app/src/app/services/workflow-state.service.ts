import { computed, Injectable, signal } from '@angular/core';
import { DatasetResponse, ProjectResponse, SchemaResponse } from './api.models';

const projectIdKey = 'forgedb.currentProjectId';
const projectNameKey = 'forgedb.currentProjectName';
const datasetIdKey = 'forgedb.currentDatasetId';
const datasetNameKey = 'forgedb.currentDatasetName';
const datasetStatusKey = 'forgedb.currentDatasetStatus';
const schemaIdKey = 'forgedb.currentSchemaId';
const schemaNameKey = 'forgedb.currentSchemaName';

@Injectable({ providedIn: 'root' })
export class WorkflowStateService {
  private readonly projectIdSignal = signal<number | null>(this.readNumber(projectIdKey));
  private readonly projectNameSignal = signal<string | null>(this.readString(projectNameKey));
  private readonly datasetIdSignal = signal<number | null>(this.readNumber(datasetIdKey));
  private readonly datasetNameSignal = signal<string | null>(this.readString(datasetNameKey));
  private readonly datasetStatusSignal = signal<string | null>(this.readString(datasetStatusKey));
  private readonly schemaIdSignal = signal<number | null>(this.readNumber(schemaIdKey));
  private readonly schemaNameSignal = signal<string | null>(this.readString(schemaNameKey));

  readonly projectId = this.projectIdSignal.asReadonly();
  readonly projectName = this.projectNameSignal.asReadonly();
  readonly datasetId = this.datasetIdSignal.asReadonly();
  readonly datasetName = this.datasetNameSignal.asReadonly();
  readonly datasetStatus = this.datasetStatusSignal.asReadonly();
  readonly schemaId = this.schemaIdSignal.asReadonly();
  readonly schemaName = this.schemaNameSignal.asReadonly();

  readonly hasProject = computed(() => this.projectIdSignal() !== null);
  readonly hasDataset = computed(() => this.datasetIdSignal() !== null);
  readonly hasSchema = computed(() => this.schemaIdSignal() !== null);

  setProject(project: ProjectResponse): void {
    this.setNumber(projectIdKey, project.id, this.projectIdSignal);
    this.setString(projectNameKey, project.name, this.projectNameSignal);
  }

  setProjectId(projectId: number, projectName?: string): void {
    this.setNumber(projectIdKey, projectId, this.projectIdSignal);
    if (projectName) {
      this.setString(projectNameKey, projectName, this.projectNameSignal);
    }
  }

  setDataset(dataset: DatasetResponse | { id: number; tableName: string; status?: string | null }): void {
    this.setNumber(datasetIdKey, dataset.id, this.datasetIdSignal);
    this.setString(datasetNameKey, dataset.tableName, this.datasetNameSignal);
    if ('status' in dataset && dataset.status) {
      this.setString(datasetStatusKey, dataset.status, this.datasetStatusSignal);
    }
  }

  setDatasetId(datasetId: number, datasetName?: string, datasetStatus?: string): void {
    this.setNumber(datasetIdKey, datasetId, this.datasetIdSignal);
    if (datasetName) {
      this.setString(datasetNameKey, datasetName, this.datasetNameSignal);
    }
    if (datasetStatus) {
      this.setString(datasetStatusKey, datasetStatus, this.datasetStatusSignal);
    }
  }

  setSchema(schema: SchemaResponse): void {
    this.setNumber(schemaIdKey, schema.schemaId, this.schemaIdSignal);
    this.setString(schemaNameKey, schema.schemaName, this.schemaNameSignal);
    this.setProjectId(schema.projectId);
    this.setDatasetId(schema.datasetId);
  }

  clearDataset(): void {
    this.clearKey(datasetIdKey, this.datasetIdSignal);
    this.clearKey(datasetNameKey, this.datasetNameSignal);
    this.clearKey(datasetStatusKey, this.datasetStatusSignal);
    this.clearSchema();
  }

  clearSchema(): void {
    this.clearKey(schemaIdKey, this.schemaIdSignal);
    this.clearKey(schemaNameKey, this.schemaNameSignal);
  }

  clearAll(): void {
    this.clearKey(projectIdKey, this.projectIdSignal);
    this.clearKey(projectNameKey, this.projectNameSignal);
    this.clearDataset();
  }

  private readNumber(key: string): number | null {
    const value = localStorage.getItem(key);
    if (!value) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private readString(key: string): string | null {
    const value = localStorage.getItem(key);
    return value && value.trim() ? value : null;
  }

  private setNumber(key: string, value: number, target: { set(value: number | null): void }): void {
    localStorage.setItem(key, String(value));
    target.set(value);
  }

  private setString(key: string, value: string, target: { set(value: string | null): void }): void {
    localStorage.setItem(key, value);
    target.set(value);
  }

  private clearKey<T>(key: string, target: { set(value: T | null): void }): void {
    localStorage.removeItem(key);
    target.set(null);
  }
}
