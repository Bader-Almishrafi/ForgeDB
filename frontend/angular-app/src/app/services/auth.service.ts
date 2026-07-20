import { computed, inject, Injectable, signal } from '@angular/core';
import { tap } from 'rxjs';
import {
  AuthResponse,
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  RequestPasswordResetRequest,
  ResetPasswordRequest,
} from './api.models';
import { ForgeApiService } from './forge-api.service';

const tokenKey = 'forgedb.token';
const userKey = 'forgedb.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ForgeApiService);
  private readonly userSignal = signal<AuthUser | null>(this.readStoredUser());
  private readonly tokenSignal = signal<string | null>(this.readStoredToken());

  // AuthService owns browser session state; ForgeApiService only sends HTTP requests.
  readonly user = this.userSignal.asReadonly();
  readonly token = this.tokenSignal.asReadonly();
  readonly isLoggedIn = computed(() => Boolean(this.tokenSignal() && this.userSignal()));

  register(request: RegisterRequest) {
    return this.api.register(request).pipe(tap((response) => this.storeSession(response)));
  }

  login(request: LoginRequest) {
    return this.api.login(request).pipe(tap((response) => this.storeSession(response)));
  }

  changePassword(request: ChangePasswordRequest) {
    return this.api.changePassword(request);
  }

  requestPasswordReset(request: RequestPasswordResetRequest) {
    return this.api.requestPasswordReset(request);
  }

  resetPassword(request: ResetPasswordRequest) {
    return this.api.resetPassword(request);
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
