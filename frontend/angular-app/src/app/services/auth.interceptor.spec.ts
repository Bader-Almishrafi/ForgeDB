import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { authTokenInterceptor } from './auth.interceptor';

describe('authTokenInterceptor', () => {
  const token = vi.fn<() => string | null>();
  const logout = vi.fn();
  const navigate = vi.fn(() => Promise.resolve(true));
  const router = { url: '/projects/10/data', navigate };

  beforeEach(() => {
    token.mockReset();
    token.mockReturnValue('signed-jwt');
    logout.mockReset();
    navigate.mockClear();
    router.url = '/projects/10/data';

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { token, logout } },
        { provide: Router, useValue: router },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('adds the current bearer token without mutating the original request', () => {
    const request = new HttpRequest('GET', '/api/projects');
    let forwarded: HttpRequest<unknown> | undefined;
    const next: HttpHandlerFn = (handledRequest) => {
      forwarded = handledRequest;
      return of(new HttpResponse({ status: 200 }));
    };

    TestBed.runInInjectionContext(() => authTokenInterceptor(request, next)).subscribe();

    expect(request.headers.has('Authorization')).toBe(false);
    expect(forwarded).not.toBe(request);
    expect(forwarded?.headers.get('Authorization')).toBe('Bearer signed-jwt');
  });

  it('logs out and navigates to login after an unauthorized API response', () => {
    const request = new HttpRequest('GET', '/api/projects');
    const unauthorized = new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' });
    let observedError: unknown;

    TestBed.runInInjectionContext(() => authTokenInterceptor(
      request,
      () => throwError(() => unauthorized),
    )).subscribe({ error: (error: unknown) => { observedError = error; } });

    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/projects/10/data' },
    });
    expect(observedError).toBe(unauthorized);
  });

  it('rethrows non-401 responses without clearing the session or navigating', () => {
    const request = new HttpRequest('GET', '/api/projects');
    const forbidden = new HttpErrorResponse({ status: 403, statusText: 'Forbidden' });
    let observedError: unknown;

    TestBed.runInInjectionContext(() => authTokenInterceptor(
      request,
      () => throwError(() => forbidden),
    )).subscribe({ error: (error: unknown) => { observedError = error; } });

    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(observedError).toBe(forbidden);
  });
});
