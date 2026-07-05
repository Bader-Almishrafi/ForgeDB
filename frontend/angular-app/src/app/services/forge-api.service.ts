import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AuthResponse,
  DashboardResponse,
  DatasetAnalysisRequest,
  DatasetAnalysisResponse,
  DatasetPreview,
  DatasetResponse,
  DeploymentRequest,
  DeploymentResponse,
  LoginRequest,
  ProjectCreateRequest,
  ProjectResponse,
  RegisterRequest,
  SchemaGenerateRequest,
  SchemaRelationshipsUpdateRequest,
  SchemaResponse,
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

  analyzeDataset(datasetId: number, request: DatasetAnalysisRequest): Observable<DatasetAnalysisResponse> {
    return this.http.post<DatasetAnalysisResponse>(`${this.baseUrl}/api/datasets/${datasetId}/analyze`, request);
  }

  getDatasetDashboard(datasetId: number): Observable<DashboardResponse> {
    return this.http.get<DashboardResponse>(`${this.baseUrl}/api/datasets/${datasetId}/dashboard`);
  }

  generateSchema(datasetId: number, request: SchemaGenerateRequest): Observable<SchemaResponse> {
    return this.http.post<SchemaResponse>(`${this.baseUrl}/api/datasets/${datasetId}/schema/generate`, request);
  }

  getSchema(schemaId: number): Observable<SchemaResponse> {
    return this.http.get<SchemaResponse>(`${this.baseUrl}/api/schemas/${schemaId}`);
  }

  updateRelationships(schemaId: number, request: SchemaRelationshipsUpdateRequest): Observable<SchemaResponse> {
    return this.http.put<SchemaResponse>(`${this.baseUrl}/api/schemas/${schemaId}/relationships`, request);
  }

  deploySchema(schemaId: number, request: DeploymentRequest): Observable<DeploymentResponse> {
    return this.http.post<DeploymentResponse>(`${this.baseUrl}/api/schemas/${schemaId}/deploy`, request);
  }
}
