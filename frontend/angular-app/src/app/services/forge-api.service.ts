import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AuthResponse,
  ApiConnectionTest,
  ApiJsonImportRequest,
  ApiJsonPreview,
  CleaningApplyRequest,
  CleaningApplyResponse,
  CleaningHistory,
  CleaningPreviewRequest,
  CleaningPreviewResponse,
  CleaningSuggestion,
  DatasetAnalysisRequest,
  DatasetAnalysisResponse,
  DatasetPreview,
  DatasetResponse,
  ExcelWorkbookPreview,
  DatasetVersion,
  LoginRequest,
  ProjectExportPackage,
  ProjectOverview,
  ProjectCreateRequest,
  ProjectResponse,
  ProjectSummary,
  ProjectWorkflow,
  ProjectUpdateRequest,
  ProjectCleaningSummary,
  QualityConfirmation,
  RegisterRequest,
  ChangePasswordRequest,
  RequestPasswordResetRequest,
  RequestPasswordResetResponse,
  ResetPasswordRequest,
} from './api.models';

@Injectable({ providedIn: 'root' })
// Centralizes typed HTTP communication and backend URLs. Components and feature services own
// workflow decisions; this service only translates calls into API requests and responses.
export class ForgeApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  register(request: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/register`, request);
  }

  login(request: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/login`, request);
  }

  // ForgeApiService owns the exact backend URL and HTTP method for each authentication operation.
  changePassword(request: ChangePasswordRequest): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/auth/change-password`, request);
  }

  requestPasswordReset(request: RequestPasswordResetRequest): Observable<RequestPasswordResetResponse> {
    return this.http.post<RequestPasswordResetResponse>(
      `${this.baseUrl}/auth/request-password-reset`,
      request,
    );
  }

  resetPassword(request: ResetPasswordRequest): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/auth/reset-password`, request);
  }

  // ---------------------------------------------------------------------------
  // Project and project-creation data-source endpoints
  // ---------------------------------------------------------------------------

  // POST /api/projects sends project creation fields and returns the persisted project,
  // including its database-generated ID for subsequent dataset imports.
  createProject(request: ProjectCreateRequest): Observable<ProjectResponse> {
    return this.http.post<ProjectResponse>(`${this.baseUrl}/projects`, request);
  }

  // GET /api/projects/{projectId} returns one authenticated, owned project.
  getProject(projectId: number): Observable<ProjectResponse> {
    return this.http.get<ProjectResponse>(`${this.baseUrl}/projects/${projectId}`);
  }

  // PUT /api/projects/{projectId} sends editable name/description fields and returns the update.
  updateProject(projectId: number, request: ProjectUpdateRequest): Observable<ProjectResponse> {
    return this.http.put<ProjectResponse>(`${this.baseUrl}/projects/${projectId}`, request);
  }

  // DELETE /api/projects/{projectId} removes the owned project and expects 204 No Content.
  deleteProject(projectId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/projects/${projectId}`);
  }

  getProjects(): Observable<ProjectSummary[]> {
    return this.http.get<ProjectSummary[]>(`${this.baseUrl}/projects`);
  }

  getProjectWorkflow(projectId: number): Observable<ProjectWorkflow> {
    return this.http.get<ProjectWorkflow>(`${this.baseUrl}/projects/${projectId}/workflow`);
  }

  // GET /api/projects/{projectId}/overview returns aggregated project, dataset, cleaning,
  // relationship, design, and recommendation information.
  getProjectOverview(projectId: number): Observable<ProjectOverview> {
    return this.http.get<ProjectOverview>(`${this.baseUrl}/projects/${projectId}/overview`);
  }

  // GET /api/projects/user/{userId} returns the authenticated user's project list.
  getUserProjects(userId: number): Observable<ProjectResponse[]> {
    return this.http.get<ProjectResponse[]>(`${this.baseUrl}/projects/user/${userId}`);
  }

  // POST /api/projects/{projectId}/datasets/upload sends CSV/Excel multipart data and returns
  // the DatasetResponse created inside the project.
  uploadDataset(projectId: number, formData: FormData): Observable<DatasetResponse> {
    return this.http.post<DatasetResponse>(`${this.baseUrl}/projects/${projectId}/datasets/upload`, formData);
  }

  // POST /api/datasets/excel/preview sends a workbook without persisting it and returns sheets,
  // selected worksheet metadata, and sampled rows for the wizard.
  previewExcel(formData: FormData): Observable<ExcelWorkbookPreview> {
    return this.http.post<ExcelWorkbookPreview>(`${this.baseUrl}/datasets/excel/preview`, formData);
  }

  // POST /api/datasets/api/test sends URL/path settings and returns connectivity diagnostics.
  testApiConnection(request: ApiJsonImportRequest): Observable<ApiConnectionTest> {
    return this.http.post<ApiConnectionTest>(`${this.baseUrl}/datasets/api/test`, request);
  }

  // POST /api/datasets/api/preview sends URL/path settings and returns a sampled JSON array
  // without creating a dataset.
  previewApi(request: ApiJsonImportRequest): Observable<ApiJsonPreview> {
    return this.http.post<ApiJsonPreview>(`${this.baseUrl}/datasets/api/preview`, request);
  }

  // POST /api/projects/{projectId}/datasets/api imports the previewed remote array and returns
  // the persisted DatasetResponse linked to the new project.
  importApi(projectId: number, request: ApiJsonImportRequest): Observable<DatasetResponse> {
    return this.http.post<DatasetResponse>(`${this.baseUrl}/projects/${projectId}/datasets/api`, request);
  }

  replaceDataset(datasetId: number, formData: FormData): Observable<DatasetResponse> {
    return this.http.post<DatasetResponse>(`${this.baseUrl}/datasets/${datasetId}/replace`, formData);
  }

  deleteDataset(datasetId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/datasets/${datasetId}`);
  }

  getProjectDatasets(projectId: number): Observable<DatasetResponse[]> {
    return this.http.get<DatasetResponse[]>(`${this.baseUrl}/projects/${projectId}/datasets`);
  }

  getDatasetPreview(datasetId: number): Observable<DatasetPreview> {
    return this.http.get<DatasetPreview>(`${this.baseUrl}/datasets/${datasetId}/preview`);
  }

  getDatasetAnalysis(datasetId: number): Observable<DatasetAnalysisResponse> {
    return this.http.get<DatasetAnalysisResponse>(`${this.baseUrl}/datasets/${datasetId}/analysis`);
  }

  analyzeDataset(datasetId: number, request: DatasetAnalysisRequest): Observable<DatasetAnalysisResponse> {
    return this.http.post<DatasetAnalysisResponse>(`${this.baseUrl}/datasets/${datasetId}/analyze`, request);
  }

  // GET /api/projects/{projectId}/exports/package returns generated schema artifacts and reports.
  getProjectExportPackage(projectId: number): Observable<ProjectExportPackage> {
    return this.http.get<ProjectExportPackage>(`${this.baseUrl}/projects/${projectId}/exports/package`);
  }

  getProjectCleaningSummary(projectId: number): Observable<ProjectCleaningSummary> {
    return this.http.get<ProjectCleaningSummary>(`${this.baseUrl}/projects/${projectId}/cleaning/summary`);
  }

  getCleaningSuggestions(projectId: number, filters: { datasetId?: number; issueType?: string; column?: string; search?: string } = {}): Observable<CleaningSuggestion[]> {
    let params = new HttpParams();
    if (filters.datasetId) params = params.set('datasetId', filters.datasetId);
    if (filters.issueType && filters.issueType !== 'all') params = params.set('issueType', filters.issueType);
    if (filters.column && filters.column !== 'all') params = params.set('column', filters.column);
    if (filters.search?.trim()) params = params.set('search', filters.search.trim());
    return this.http.get<CleaningSuggestion[]>(`${this.baseUrl}/projects/${projectId}/cleaning/suggestions`, { params });
  }

  previewCleaning(projectId: number, request: CleaningPreviewRequest): Observable<CleaningPreviewResponse> {
    return this.http.post<CleaningPreviewResponse>(`${this.baseUrl}/projects/${projectId}/cleaning/preview`, request);
  }

  applyCleaning(projectId: number, request: CleaningApplyRequest): Observable<CleaningApplyResponse> {
    return this.http.post<CleaningApplyResponse>(`${this.baseUrl}/projects/${projectId}/cleaning/apply`, request);
  }

  getCleaningHistory(projectId: number): Observable<CleaningHistory> {
    return this.http.get<CleaningHistory>(`${this.baseUrl}/projects/${projectId}/cleaning/history`);
  }

  getDatasetVersions(projectId: number, datasetId: number): Observable<DatasetVersion[]> {
    return this.http.get<DatasetVersion[]>(`${this.baseUrl}/projects/${projectId}/cleaning/datasets/${datasetId}/versions`);
  }

  undoLatestCleaning(projectId: number): Observable<CleaningApplyResponse> {
    return this.http.post<CleaningApplyResponse>(`${this.baseUrl}/projects/${projectId}/cleaning/undo-latest`, {});
  }

  restoreDatasetVersion(projectId: number, datasetId: number, versionId: number): Observable<CleaningApplyResponse> {
    return this.http.post<CleaningApplyResponse>(`${this.baseUrl}/projects/${projectId}/cleaning/datasets/${datasetId}/restore`, { versionId });
  }

  confirmCleaningQuality(projectId: number): Observable<QualityConfirmation> {
    return this.http.post<QualityConfirmation>(`${this.baseUrl}/projects/${projectId}/cleaning/confirm-quality`, {});
  }
}
