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

export interface SchemaGenerateRequest {
  schemaName: string;
  options?: unknown;
}

export interface SchemaResponse {
  id: number;
  schemaId: number;
  projectId: number;
  datasetId: number;
  schemaName: string;
  generatedTableName: string;
  generatedColumns: SchemaColumn[];
  sqlPreview: string;
  relationships: SchemaRelationship[];
  dbmlContent?: string | null;
  schemaJson?: string | null;
  sqlContent?: string | null;
  relationshipsJson?: string | null;
  version: number;
  status: string;
  createdAt: string;
  updatedAt?: string | null;
}

export interface SchemaColumn {
  name: string;
  sourceColumnName: string;
  detectedDataType: string;
  sqlType: string;
  isNullable: boolean;
}

export interface SchemaRelationship {
  name?: string | null;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  relationshipType?: string | null;
}

export interface SchemaRelationshipsUpdateRequest {
  relationships: SchemaRelationship[];
}

export interface DeploymentRequest {
  databaseName: string;
}

export interface DeploymentResponse {
  id: number;
  deploymentId: number;
  projectId: number;
  schemaId: number;
  databaseName: string;
  status: string;
  sqlScript: string;
  createdAt: string;
  deployedAt?: string | null;
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
}

export interface DesignTable {
  id: number;
  name: string;
  comment?: string | null;
  sourceDatasetId?: number | null;
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
  layout: unknown | null;
  createdAt: string;
  updatedAt: string;
  tables: DesignTable[];
  relationships: DesignRelationship[];
  validationIssues: ValidationIssue[];
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
