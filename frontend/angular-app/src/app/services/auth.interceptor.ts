import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.token();

  const authRequest = token
    ? request.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      })
    : request;

  return next(authRequest).pipe(
    catchError((error: unknown) => {
      // When the JWT token expires or is invalid (401 Unauthorized) during session usage,
      // clear session state and redirect directly to login rather than showing cryptic error alerts.
      if (error instanceof HttpErrorResponse && error.status === 401 && !router.url.startsWith('/login')) {
        const returnUrl = router.url.startsWith('/') && !router.url.startsWith('//') ? router.url : '/projects';
        authService.logout();
        void router.navigate(['/login'], { queryParams: { returnUrl } });
      }
      return throwError(() => error);
    })
  );
};
