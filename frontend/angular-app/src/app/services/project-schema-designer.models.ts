import { DatasetVersion, DesignModelResponse, ProjectWorkflow, ProjectWorkflowDataset } from './api.models';

export type FeedbackKind = 'success' | 'warning' | 'error';

export interface Feedback {
  kind: FeedbackKind;
  title: string;
  message: string;
}

export interface SchemaWorkspace {
  workflow: ProjectWorkflow | null;
  design: DesignModelResponse | null;
  versions: Record<number, DatasetVersion[]>;
}

export interface SchemaSourceRow {
  dataset: ProjectWorkflowDataset;
  activeVersion?: DatasetVersion;
  schemaVersion?: DatasetVersion;
  schemaVersionId: number | null;
  usesCurrentVersion: boolean;
}
