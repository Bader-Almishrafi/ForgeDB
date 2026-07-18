import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(AuthService).token();

  if (!token) {
    return next(request);
  }

  // Protected API calls receive the current JWT here, so components never build Authorization headers.
  return next(request.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`,
    },
  }));
};
