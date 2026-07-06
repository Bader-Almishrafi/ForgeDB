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
