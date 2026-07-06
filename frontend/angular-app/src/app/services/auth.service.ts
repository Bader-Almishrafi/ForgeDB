import { computed, inject, Injectable, signal } from '@angular/core';
import { tap } from 'rxjs';
import { AuthResponse, AuthUser, LoginRequest, RegisterRequest } from './api.models';
import { ForgeApiService } from './forge-api.service';
import { WorkflowStateService } from './workflow-state.service';

const tokenKey = 'forgedb.token';
const userKey = 'forgedb.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ForgeApiService);
  private readonly workflow = inject(WorkflowStateService);
  private readonly userSignal = signal<AuthUser | null>(this.readStoredUser());
  private readonly tokenSignal = signal<string | null>(this.readStoredToken());

  readonly user = this.userSignal.asReadonly();
  readonly token = this.tokenSignal.asReadonly();
  readonly isLoggedIn = computed(() => Boolean(this.tokenSignal() && this.userSignal()));

  register(request: RegisterRequest) {
    return this.api.register(request).pipe(tap((response) => this.storeSession(response)));
  }

  login(request: LoginRequest) {
    return this.api.login(request).pipe(tap((response) => this.storeSession(response)));
  }

  logout(): void {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(userKey);
    this.tokenSignal.set(null);
    this.userSignal.set(null);
  }

  userId(): number | null {
    return this.userSignal()?.id ?? null;
  }

  private storeSession(response: AuthResponse): void {
    this.workflow.clearAll();
    localStorage.setItem(tokenKey, response.token);
    localStorage.setItem(userKey, JSON.stringify(response.user));
    this.tokenSignal.set(response.token);
    this.userSignal.set(response.user);
  }

  private readStoredToken(): string | null {
    return localStorage.getItem(tokenKey);
  }

  private readStoredUser(): AuthUser | null {
    const value = localStorage.getItem(userKey);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as AuthUser;
    } catch {
      localStorage.removeItem(userKey);
      return null;
    }
  }
}
