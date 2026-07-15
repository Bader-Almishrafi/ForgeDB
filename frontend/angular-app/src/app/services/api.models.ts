export interface AuthUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}

export interface RegisterRequest {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ProjectResponse {
  id: number;
  userId: number;
  name: string;
  description?: string | null;
  dashboardConfig?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface ProjectCreateRequest {
  userId: number;
  name: string;
  description?: string | null;
}

export interface ProjectUpdateRequest {
  name: string;
  description?: string | null;
}

export interface DatasetResponse {
  id: number;
  projectId: number;
  tableName: string;
  sourceType: string;
  sourceName?: string | null;
  rowCount: number;
  columnCount: number;
  missingValuesCount: number;
  duplicateRowsCount: number;
  status: string;
  createdAt: string;
}

export interface DatasetPreview {
  datasetId: number;
  tableName: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ExcelWorkbookPreview {
  fileName: string;
  worksheets: string[];
  selectedWorksheet?: string | null;
  rowCount: number;
  columnCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ApiJsonImportRequest {
  apiUrl: string;
  arrayPath?: string | null;
  tableName?: string | null;
}

export interface ApiConnectionTest {
  success: boolean;
  url: string;
  statusCode: number;
  contentType: string;
  responseBytes: number;
  recordCount: number;
  message: string;
}

export interface ApiJsonPreview {
  url: string;
  arrayPath?: string | null;
  rowCount: number;
  columnCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface DatasetAnalysisRequest {
  analysisType: string;
  options?: unknown;
}

export interface DatasetAnalysisResponse {
  datasetId: number;
  tableName: string;
  status: string;
  analysisResult: DatasetAnalysisResult;
  chartRecommendations: ChartRecommendation[];
  keyCandidates?: KeyCandidate[];
  dateRanges?: DateRange[];
  relationshipCandidateHints?: RelationshipCandidateHint[];
  analyzedAt?: string | null;
  datasetVersionId?: number | null;
  datasetVersionNumber?: number | null;
  isCleanedVersion: boolean;
}

export interface CleaningColumnSnapshot {
  name: string;
  dataType: string;
}

export interface CleaningStrategy {
  key: string;
  label: string;
  operationType: string;
  parameters: Record<string, unknown>;
  isSafeRecommended: boolean;
  isDestructive: boolean;
}

export interface CleaningSuggestion {
  id: string;
  projectId: number;
  datasetId: number;
  versionId: number;
  datasetName: string;
  issueType: string;
  column?: string | null;
  count: number;
  percentage?: number | null;
  riskLabel: string;
  description: string;
  recommendedStrategy: CleaningStrategy;
  availableStrategies: CleaningStrategy[];
}

export interface ProjectCleaningSummary {
  projectId: number;
  projectName: string;
  totalDatasets: number;
  analyzedDatasets: number;
  unanalyzedDatasets: number;
  totalRows: number;
  totalColumns: number;
  totalIssues: number;
  rowsAffected: number;
  cellsAffected: number;
  missingValues: number;
  duplicateRows: number;
  dataQualityScore?: number | null;
  lastAnalyzedAt?: string | null;
  hasCleaningBatches: boolean;
  requiresReanalysis: boolean;
  canConfirmQuality: boolean;
  qualityConfirmed: boolean;
  schemaReady: boolean;
  qualityConfirmedAt?: string | null;
  datasets: DatasetCleaningSummary[];
  issueCounts: Record<string, number>;
}

export interface DatasetCleaningSummary {
  datasetId: number;
  datasetName: string;
  activeVersionId: number;
  versionNumber: number;
  isRawOriginal: boolean;
  rowCount?: number;
  columnCount: number;
  missingValuesCount: number;
  duplicateRowsCount: number;
  analyzedAt?: string | null;
  requiresReanalysis: boolean;
}

export interface CleaningOperationRequest {
  operationId?: string | null;
  suggestionId?: string | null;
  datasetId: number;
  operationType: string;
  column?: string | null;
  parameters: Record<string, unknown>;
}

export interface CleaningPreviewRequest {
  operations: CleaningOperationRequest[];
}

export interface CleaningApplyRequest extends CleaningPreviewRequest {
  batchName?: string | null;
  confirmDestructive: boolean;
}

export interface CleaningApplyRecommendedRequest {
  suggestionIds: string[];
  confirmDestructive: boolean;
}

export interface CleaningPreviewResponse {
  datasets: DatasetCleaningPreview[];
  affectedRows: number;
  affectedCells: number;
  rowsRemoved: number;
  columnsRemoved: number;
  destructive: boolean;
  warnings: string[];
}

export interface DatasetCleaningPreview {
  datasetId: number;
  datasetName: string;
  sourceVersionId: number;
  executionOrder: string[];
  rows: CleaningPreviewRow[];
  operationResults: CleaningOperationResult[];
  affectedRows: number;
  affectedCells: number;
  rowsRemoved: number;
  columnsRemoved: number;
  columnsRenamed: number;
  destructive: boolean;
  conversionFailures: CleaningConversionFailure[];
  warnings: string[];
}

export interface CleaningPreviewRow {
  rowNumber: number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface CleaningConversionFailure {
  rowNumber: number;
  column: string;
  value: unknown;
  reason: string;
}

export interface CleaningOperationResult {
  operationId: string;
  operationType: string;
  column?: string | null;
  affectedRows: number;
  affectedCells: number;
  rowsRemoved: number;
  columnsRemoved: number;
  columnsRenamed: number;
  destructive: boolean;
  warnings: string[];
}

export interface CleaningApplyResponse {
  batchId: number;
  correlationId: string;
  status: string;
  datasets: DatasetCleaningApplyResult[];
  rowsAffected: number;
  cellsAffected: number;
}

export interface DatasetCleaningApplyResult {
  datasetId: number;
  datasetName: string;
  success: boolean;
  versionId?: number | null;
  versionNumber?: number | null;
  rowsAffected: number;
  cellsAffected: number;
  error?: string | null;
}

export interface CleaningHistory {
  entries: CleaningHistoryEntry[];
}

export interface CleaningHistoryEntry {
  batchId: number;
  correlationId: string;
  name: string;
  user: string;
  createdAt: string;
  completedAt?: string | null;
  status: string;
  isUndo: boolean;
  isRestore: boolean;
  operationCount: number;
  rowsAffected: number;
  cellsAffected: number;
  failureDetails?: string | null;
  canUndo: boolean;
  operations: CleaningHistoryOperation[];
}

export interface CleaningHistoryOperation {
  id: number;
  datasetId: number;
  datasetName: string;
  operationType: string;
  column?: string | null;
  status: string;
  rowsAffected: number;
  cellsAffected: number;
  resultVersionId?: number | null;
  resultVersionNumber?: number | null;
  isDestructive: boolean;
  failureMessage?: string | null;
}

export interface DatasetVersion {
  id: number;
  datasetId: number;
  parentVersionId?: number | null;
  versionNumber: number;
  isRawOriginal: boolean;
  isActive: boolean;
  rowCount?: number;
  columnCount: number;
  operationSummary: string;
  createdAt: string;
  analyzedAt?: string | null;
  createdBy: string;
}

export interface QualityConfirmation {
  projectId: number;
  qualityConfirmed: boolean;
  schemaReady: boolean;
  confirmedAt: string;
  confirmedVersions: Record<number, number>;
}

export interface CleanedDatasetPreview {
  datasetId: number;
  tableName: string;
  versionId: number;
  versionNumber: number;
  isRawOriginal: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface DatasetAnalysisResult {
  rowCount: number;
  columnCount: number;
  missingValuesCount: number;
  duplicateRowsCount: number;
  duplicateRowRule: string;
  columns: ColumnAnalysis[];
  columnTypeDistribution: ColumnTypeDistribution[];
}

export interface ColumnAnalysis {
  columnName: string;
  detectedDataType: string;
  missingValuesCount: number;
  uniqueValuesCount: number;
  isNullable: boolean;
  sampleValues: string[];
  numericStats?: NumericColumnStats | null;
  mostCommonValues: ValueFrequency[];
}

export interface NumericColumnStats {
  columnName: string;
  min: number;
  max: number;
  average: number;
  count: number;
}

export interface ValueFrequency {
  value?: string | null;
  count: number;
}

export interface ColumnTypeDistribution {
  dataType: string;
  count: number;
}

export interface ChartRecommendation {
  chartType: string;
  title: string;
  columns: string[];
  xColumn?: string | null;
  yColumn?: string | null;
  reason?: string | null;
  usefulness?: string | null;
  previewData?: ChartPreviewPoint[];
}

export interface ChartPreviewPoint {
  label: string;
  value: number;
}

export interface KeyCandidate {
  columnName: string;
  confidence: number;
  reasons: string[];
}

export interface DateRange {
  columnName: string;
  min?: string | null;
  max?: string | null;
}

export interface RelationshipCandidateHint {
  columnName: string;
  hint: string;
}

export interface DashboardResponse {
  datasetId: number;
  tableName: string;
  rowCount: number;
  columnCount: number;
  missingValuesCount: number;
  duplicateRowsCount: number;
  metrics: DashboardMetric[];
  columnTypeDistribution: ColumnTypeDistribution[];
  numericSummaries: NumericColumnStats[];
  topValueSummaries: DashboardTopValues[];
  chartRecommendations: ChartRecommendation[];
}

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  unit?: string | null;
}

export interface DashboardTopValues {
  columnName: string;
  values: ValueFrequency[];
}

export interface ApiErrorBody {
  message?: string;
}

export interface ProjectOverview {
  projectId: number;
  projectName: string;
  datasetsCount: number;
  totalRows: number;
  totalColumns: number;
  analyzedDatasetsCount: number;
  cleaningBatchesCount: number;
  qualityConfirmed: boolean;
  schemaReady: boolean;
  generatedSchemasCount: number;
  relationshipSuggestionsCount: number;
  acceptedRelationshipsCount: number;
  exportReadinessStatus: string;
  recentDatasets: DatasetResponse[];
  nextRecommendedActions: string[];
}

export interface ProjectRelationshipSuggestion {
  suggestionId: string;
  fromDatasetId: number;
  fromTable: string;
  fromColumn: string;
  toDatasetId: number;
  toTable: string;
  toColumn: string;
  relationshipType: string;
  confidence: number;
  reasons: string[];
  status: 'suggested' | 'accepted' | 'rejected' | string;
}

export interface ProjectSchema {
  projectId: number;
  projectName: string;
  status: string;
  tables: ProjectSchemaTable[];
  relationships: ProjectRelationshipSuggestion[];
  sqlPreview: string;
  dbmlPreview: string;
  jsonPreview: string;
}

export interface ProjectSchemaTable {
  datasetId: number;
  tableName: string;
  status: string;
  columns: ProjectSchemaColumn[];
  primaryKeyCandidates: string[];
}

export interface ProjectSchemaColumn {
  name: string;
  sourceColumnName: string;
  detectedDataType: string;
  sqlType: string;
  isNullable: boolean;
  isPrimaryKeyCandidate: boolean;
}

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning' | string;
  message: string;
  tableId?: number | null;
  columnId?: number | null;
  relationshipId?: number | null;
}

export interface DesignColumn {
  id: number;
  name: string;
  sqlType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  ordinal: number;
  sourceColumnName?: string | null;
  origin: string;
  defaultValue?: string | null;
  isAutoIncrement?: boolean;
}

export interface DesignTable {
  id: number;
  name: string;
  comment?: string | null;
  sourceDatasetId?: number | null;
  sourceDatasetVersionId?: number | null;
  sourceName?: string | null;
  rowCount?: number;
  origin: string;
  columns: DesignColumn[];
}

export interface DesignRelationship {
  id: number;
  fromColumnId: number;
  fromTableId: number;
  fromTableName: string;
  fromColumnName: string;
  toColumnId: number;
  toTableId: number;
  toTableName: string;
  toColumnName: string;
  cardinality: 'many-to-one' | 'one-to-one' | string;
  onDelete: 'no-action' | 'cascade' | 'set-null' | string;
  origin: string;
  suggestionId?: number | null;
}

export interface DesignModelResponse {
  id: number;
  projectId: number;
  revision: number;
  status?: 'Draft' | 'Invalid' | 'Valid' | string;
  isStale?: boolean;
  canContinue?: boolean;
  generatedAt?: string | null;
  validatedAt?: string | null;
  lastModifiedBy?: string | null;
  source?: string;
  sourceVersions?: Record<number, number>;
  sqlPreview?: string;
  layout: unknown | null;
  createdAt: string;
  updatedAt: string;
  tables: DesignTable[];
  relationships: DesignRelationship[];
  validationIssues: ValidationIssue[];
}

export interface SaveDesignDraftRequest {
  tables: Array<{ id: number; name: string }>;
  columns: Array<{
    id: number;
    name: string;
    dataType: string;
    isNullable: boolean;
    isPrimaryKey: boolean;
    isUnique: boolean;
    defaultValue?: string | null;
    isAutoIncrement: boolean;
  }>;
}

export interface SchemaSqlPreview {
  designId: number;
  revision: number;
  sql: string;
}

export interface DeploymentResponse {
  id: number;
  projectId: number;
  designRevision: number;
  schemaName: string;
  status: 'Running' | 'Succeeded' | 'Failed' | string;
  generatedSql: string;
  errorMessage?: string | null;
  createdTables: string[];
  insertedRowCounts: Record<string, number>;
  totalRowsInserted: number;
  startedAt: string;
  completedAt?: string | null;
}

export interface GenerateDesignRequest {
  mode: 'merge' | 'replace';
}

export interface CreateDesignTableRequest {
  name: string;
  comment?: string | null;
}

export interface UpdateDesignTableRequest {
  name: string;
  comment?: string | null;
}

export interface CreateDesignColumnRequest {
  name: string;
  sqlType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  ordinal: number;
  sourceColumnName?: string | null;
}

export interface UpdateDesignColumnRequest {
  name: string;
  sqlType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  ordinal: number;
}

export interface CreateDesignRelationshipRequest {
  fromColumnId: number;
  toColumnId: number;
  cardinality: string;
  onDelete: string;
}

export type AcceptSuggestionRequest = CreateDesignRelationshipRequest;

export interface UpdateDesignRelationshipRequest {
  cardinality: string;
  onDelete: string;
}

export interface UpdateDesignLayoutRequest {
  layout: unknown | null;
}

export interface RelationshipSuggestion {
  id: number;
  projectId: number;
  sourceDatasetId: number;
  sourceTableName: string;
  sourceColumnName: string;
  targetDatasetId: number;
  targetTableName: string;
  targetColumnName: string;
  score: number;
  evidenceJson?: string | null;
  status: 'suggested' | 'accepted' | 'rejected' | string;
  decidedAt?: string | null;
  createdAt: string;
}

export interface AcceptSuggestionResponse {
  suggestion: RelationshipSuggestion;
  relationship: DesignRelationship;
  designRevision: number;
}

export interface DesignConflictError {
  currentRevision: number;
  message: string;
}

export interface ProjectExportPackage {
  projectId: number;
  projectName: string;
  status: string;
  generatedAt: string;
  sql: string;
  dbml: string;
  jsonSchema: string;
  relationshipReportJson: string;
  dataQualityReportJson: string;
}
