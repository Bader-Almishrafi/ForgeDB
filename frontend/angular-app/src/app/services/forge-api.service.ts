import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AuthResponse,
  CleanedDatasetPreview,
  CleaningApplyRecommendedRequest,
  CleaningApplyRequest,
  CleaningApplyResponse,
  CleaningHistory,
  CleaningPreviewRequest,
  CleaningPreviewResponse,
  CleaningSuggestion,
  DashboardResponse,
  DatasetAnalysisRequest,
  DatasetAnalysisResponse,
  DatasetPreview,
  DatasetResponse,
  DatasetVersion,
  LoginRequest,
  ProjectExportPackage,
  ProjectOverview,
  ProjectCreateRequest,
  ProjectResponse,
  ProjectCleaningSummary,
  QualityConfirmation,
  RegisterRequest,
} from './api.models';

@Injectable({ providedIn: 'root' })
export class ForgeApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  register(request: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/api/auth/register`, request);
  }

  login(request: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/api/auth/login`, request);
  }

  createProject(request: ProjectCreateRequest): Observable<ProjectResponse> {
    return this.http.post<ProjectResponse>(`${this.baseUrl}/api/projects`, request);
  }

  getProject(projectId: number): Observable<ProjectResponse> {
    return this.http.get<ProjectResponse>(`${this.baseUrl}/api/projects/${projectId}`);
  }

  getProjectOverview(projectId: number): Observable<ProjectOverview> {
    return this.http.get<ProjectOverview>(`${this.baseUrl}/api/projects/${projectId}/overview`);
  }

  getUserProjects(userId: number): Observable<ProjectResponse[]> {
    return this.http.get<ProjectResponse[]>(`${this.baseUrl}/api/projects/user/${userId}`);
  }

  uploadDataset(projectId: number, formData: FormData): Observable<DatasetResponse> {
    return this.http.post<DatasetResponse>(`${this.baseUrl}/api/projects/${projectId}/datasets/upload`, formData);
  }

  getProjectDatasets(projectId: number): Observable<DatasetResponse[]> {
    return this.http.get<DatasetResponse[]>(`${this.baseUrl}/api/projects/${projectId}/datasets`);
  }

  getDatasetPreview(datasetId: number): Observable<DatasetPreview> {
    return this.http.get<DatasetPreview>(`${this.baseUrl}/api/datasets/${datasetId}/preview`);
  }

  getDatasetAnalysis(datasetId: number): Observable<DatasetAnalysisResponse> {
    return this.http.get<DatasetAnalysisResponse>(`${this.baseUrl}/api/datasets/${datasetId}/analysis`);
  }

  getDatasetProfile(datasetId: number): Observable<DatasetAnalysisResponse> {
    return this.http.get<DatasetAnalysisResponse>(`${this.baseUrl}/api/datasets/${datasetId}/profile`);
  }

  analyzeDataset(datasetId: number, request: DatasetAnalysisRequest): Observable<DatasetAnalysisResponse> {
    return this.http.post<DatasetAnalysisResponse>(`${this.baseUrl}/api/datasets/${datasetId}/analyze`, request);
  }

  getDatasetDashboard(datasetId: number): Observable<DashboardResponse> {
    return this.http.get<DashboardResponse>(`${this.baseUrl}/api/datasets/${datasetId}/dashboard`);
  }

  getProjectExportPackage(projectId: number): Observable<ProjectExportPackage> {
    return this.http.get<ProjectExportPackage>(`${this.baseUrl}/api/projects/${projectId}/exports/package`);
  }

  getProjectCleaningSummary(projectId: number): Observable<ProjectCleaningSummary> {
    return this.http.get<ProjectCleaningSummary>(`${this.baseUrl}/api/projects/${projectId}/cleaning/summary`);
  }

  getCleaningSuggestions(projectId: number, filters: { datasetId?: number; issueType?: string; column?: string; search?: string } = {}): Observable<CleaningSuggestion[]> {
    let params = new HttpParams();
    if (filters.datasetId) params = params.set('datasetId', filters.datasetId);
    if (filters.issueType && filters.issueType !== 'all') params = params.set('issueType', filters.issueType);
    if (filters.column && filters.column !== 'all') params = params.set('column', filters.column);
    if (filters.search?.trim()) params = params.set('search', filters.search.trim());
    return this.http.get<CleaningSuggestion[]>(`${this.baseUrl}/api/projects/${projectId}/cleaning/suggestions`, { params });
  }

  previewCleaning(projectId: number, request: CleaningPreviewRequest): Observable<CleaningPreviewResponse> {
    return this.http.post<CleaningPreviewResponse>(`${this.baseUrl}/api/projects/${projectId}/cleaning/preview`, request);
  }

  applyCleaning(projectId: number, request: CleaningApplyRequest): Observable<CleaningApplyResponse> {
    return this.http.post<CleaningApplyResponse>(`${this.baseUrl}/api/projects/${projectId}/cleaning/apply`, request);
  }

  applyRecommendedCleaning(projectId: number, request: CleaningApplyRecommendedRequest): Observable<CleaningApplyResponse> {
    return this.http.post<CleaningApplyResponse>(`${this.baseUrl}/api/projects/${projectId}/cleaning/apply-recommended`, request);
  }

  getCleaningHistory(projectId: number): Observable<CleaningHistory> {
    return this.http.get<CleaningHistory>(`${this.baseUrl}/api/projects/${projectId}/cleaning/history`);
  }

  getDatasetVersions(projectId: number, datasetId: number): Observable<DatasetVersion[]> {
    return this.http.get<DatasetVersion[]>(`${this.baseUrl}/api/projects/${projectId}/cleaning/datasets/${datasetId}/versions`);
  }

  getCleanedDatasetPreview(projectId: number, datasetId: number): Observable<CleanedDatasetPreview> {
    return this.http.get<CleanedDatasetPreview>(`${this.baseUrl}/api/projects/${projectId}/cleaning/datasets/${datasetId}/preview`);
  }

  undoLatestCleaning(projectId: number): Observable<CleaningApplyResponse> {
    return this.http.post<CleaningApplyResponse>(`${this.baseUrl}/api/projects/${projectId}/cleaning/undo-latest`, {});
  }

  restoreDatasetVersion(projectId: number, datasetId: number, versionId: number): Observable<CleaningApplyResponse> {
    return this.http.post<CleaningApplyResponse>(`${this.baseUrl}/api/projects/${projectId}/cleaning/datasets/${datasetId}/restore`, { versionId });
  }

  confirmCleaningQuality(projectId: number): Observable<QualityConfirmation> {
    return this.http.post<QualityConfirmation>(`${this.baseUrl}/api/projects/${projectId}/cleaning/confirm-quality`, {});
  }
}
