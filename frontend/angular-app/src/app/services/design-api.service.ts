import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AcceptSuggestionResponse,
  CreateDesignColumnRequest,
  CreateDesignRelationshipRequest,
  CreateDesignTableRequest,
  DesignModelResponse,
  RelationshipSuggestion,
  UpdateDesignColumnRequest,
  UpdateDesignLayoutRequest,
  UpdateDesignRelationshipRequest,
  UpdateDesignTableRequest,
  ValidationIssue,
  SaveDesignDraftRequest,
  SchemaSqlPreview,
} from './api.models';

/**
 * Client for the Phase 1 Design API. Every mutation call takes the last-known revision and sends
 * it as `If-Match`; a stale revision comes back as an HTTP 409 with `{ currentRevision, message }`
 * in the body — callers should re-fetch the design and retry, or surface the conflict to the user.
 */
@Injectable({ providedIn: 'root' })
export class DesignApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/$/, '');

  getDesign(projectId: number): Observable<DesignModelResponse> {
    return this.http.get<DesignModelResponse>(`${this.baseUrl}/api/projects/${projectId}/design`);
  }

  getSchema(projectId: number): Observable<DesignModelResponse> {
    return this.http.get<DesignModelResponse>(`${this.baseUrl}/api/projects/${projectId}/schema`);
  }

  generateSchema(projectId: number, revision?: number): Observable<DesignModelResponse> {
    return this.http.post<DesignModelResponse>(
      `${this.baseUrl}/api/projects/${projectId}/schema/generate`,
      {},
      revision != null ? { headers: this.ifMatch(revision) } : {},
    );
  }

  saveSchemaDraft(projectId: number, revision: number, request: SaveDesignDraftRequest): Observable<DesignModelResponse> {
    return this.http.patch<DesignModelResponse>(`${this.baseUrl}/api/projects/${projectId}/schema/draft`, request, {
      headers: this.ifMatch(revision),
    });
  }

  validateSchema(projectId: number, revision: number): Observable<DesignModelResponse> {
    return this.http.post<DesignModelResponse>(`${this.baseUrl}/api/projects/${projectId}/schema/validate`, {}, {
      headers: this.ifMatch(revision),
    });
  }

  getSchemaSql(projectId: number): Observable<SchemaSqlPreview> {
    return this.http.get<SchemaSqlPreview>(`${this.baseUrl}/api/projects/${projectId}/schema/sql`);
  }

  /**
   * `revision` should be omitted only for the empty-state case (no design exists yet for this
   * project, so there is nothing to send as If-Match). Whenever a design is already loaded, pass
   * its revision so the request carries If-Match like every other mutation — the backend requires
   * it once a DesignModel exists (missing -> 428, stale -> 409 with `currentRevision`).
   */
  generateDesign(projectId: number, mode: 'merge' | 'replace' = 'merge', revision?: number): Observable<DesignModelResponse> {
    return this.http.post<DesignModelResponse>(
      `${this.baseUrl}/api/projects/${projectId}/design/generate`,
      { mode },
      revision != null ? { headers: this.ifMatch(revision) } : {},
    );
  }

  getPreview(designId: number, format: 'sql' | 'dbml' | 'json'): Observable<string> {
    return this.http.get(`${this.baseUrl}/api/designs/${designId}/preview`, {
      params: { format },
      responseType: 'text',
    });
  }

  getValidation(designId: number): Observable<ValidationIssue[]> {
    return this.http.get<ValidationIssue[]>(`${this.baseUrl}/api/designs/${designId}/validation`);
  }

  createTable(designId: number, revision: number, request: CreateDesignTableRequest): Observable<DesignModelResponse> {
    return this.http.post<DesignModelResponse>(`${this.baseUrl}/api/designs/${designId}/tables`, request, {
      headers: this.ifMatch(revision),
    });
  }

  updateTable(tableId: number, revision: number, request: UpdateDesignTableRequest): Observable<DesignModelResponse> {
    return this.http.patch<DesignModelResponse>(`${this.baseUrl}/api/design-tables/${tableId}`, request, {
      headers: this.ifMatch(revision),
    });
  }

  deleteTable(tableId: number, revision: number): Observable<DesignModelResponse> {
    return this.http.delete<DesignModelResponse>(`${this.baseUrl}/api/design-tables/${tableId}`, {
      headers: this.ifMatch(revision),
    });
  }

  createColumn(tableId: number, revision: number, request: CreateDesignColumnRequest): Observable<DesignModelResponse> {
    return this.http.post<DesignModelResponse>(`${this.baseUrl}/api/design-tables/${tableId}/columns`, request, {
      headers: this.ifMatch(revision),
    });
  }

  updateColumn(columnId: number, revision: number, request: UpdateDesignColumnRequest): Observable<DesignModelResponse> {
    return this.http.patch<DesignModelResponse>(`${this.baseUrl}/api/design-columns/${columnId}`, request, {
      headers: this.ifMatch(revision),
    });
  }

  deleteColumn(columnId: number, revision: number): Observable<DesignModelResponse> {
    return this.http.delete<DesignModelResponse>(`${this.baseUrl}/api/design-columns/${columnId}`, {
      headers: this.ifMatch(revision),
    });
  }

  /** `columnIds` must be the complete ordered list of the table's column ids (server validates
   * set equality with the existing columns). Applies every ordinal in one transaction with a
   * single revision bump, replacing what used to be two sequential updateColumn PATCHes. */
  reorderColumns(tableId: number, revision: number, columnIds: number[]): Observable<DesignModelResponse> {
    return this.http.post<DesignModelResponse>(
      `${this.baseUrl}/api/design-tables/${tableId}/columns/reorder`,
      { columnIds },
      { headers: this.ifMatch(revision) },
    );
  }

  createRelationship(designId: number, revision: number, request: CreateDesignRelationshipRequest): Observable<DesignModelResponse> {
    return this.http.post<DesignModelResponse>(`${this.baseUrl}/api/designs/${designId}/relationships`, request, {
      headers: this.ifMatch(revision),
    });
  }

  updateRelationship(relationshipId: number, revision: number, request: UpdateDesignRelationshipRequest): Observable<DesignModelResponse> {
    return this.http.patch<DesignModelResponse>(`${this.baseUrl}/api/design-relationships/${relationshipId}`, request, {
      headers: this.ifMatch(revision),
    });
  }

  deleteRelationship(relationshipId: number, revision: number): Observable<DesignModelResponse> {
    return this.http.delete<DesignModelResponse>(`${this.baseUrl}/api/design-relationships/${relationshipId}`, {
      headers: this.ifMatch(revision),
    });
  }

  updateLayout(designId: number, revision: number, request: UpdateDesignLayoutRequest): Observable<DesignModelResponse> {
    return this.http.put<DesignModelResponse>(`${this.baseUrl}/api/designs/${designId}/layout`, request, {
      headers: this.ifMatch(revision),
    });
  }

  getSuggestions(projectId: number, status?: string): Observable<RelationshipSuggestion[]> {
    return this.http.get<RelationshipSuggestion[]>(`${this.baseUrl}/api/projects/${projectId}/relationship-suggestions`, {
      params: status ? { status } : {},
    });
  }

  detectSuggestions(projectId: number): Observable<RelationshipSuggestion[]> {
    return this.http.post<RelationshipSuggestion[]>(`${this.baseUrl}/api/projects/${projectId}/relationship-suggestions/detect`, {});
  }

  /** Accept mutates the project's DesignModel, so — unlike reject — it requires If-Match with
   * the caller's last-known design revision (missing -> 428, stale -> 409 with currentRevision). */
  acceptSuggestion(suggestionId: number, revision: number): Observable<AcceptSuggestionResponse> {
    return this.http.post<AcceptSuggestionResponse>(
      `${this.baseUrl}/api/relationship-suggestions/${suggestionId}/accept`,
      {},
      { headers: this.ifMatch(revision) },
    );
  }

  rejectSuggestion(suggestionId: number): Observable<RelationshipSuggestion> {
    return this.http.post<RelationshipSuggestion>(`${this.baseUrl}/api/relationship-suggestions/${suggestionId}/reject`, {});
  }

  /** True when an error response is a 409 revision conflict (stale If-Match). */
  isRevisionConflict(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { status?: number }).status === 409;
  }

  private ifMatch(revision: number): HttpHeaders {
    return new HttpHeaders({ 'If-Match': String(revision) });
  }
}
