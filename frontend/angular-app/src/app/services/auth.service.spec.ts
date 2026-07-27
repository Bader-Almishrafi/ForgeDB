import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthUser } from './api.models';
import { AuthService } from './auth.service';
import { ForgeApiService } from './forge-api.service';

const storedUser: AuthUser = {
  id: 7,
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'User',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('AuthService persisted sessions', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: ForgeApiService, useValue: {} },
      ],
    });
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('keeps a persisted user and JWT whose expiry is still in the future', () => {
    const token = jwtWithExpiry(Math.floor(Date.now() / 1000) + 3600);
    persistSession(token);

    const service = TestBed.inject(AuthService);

    expect(service.token()).toBe(token);
    expect(service.user()).toEqual(storedUser);
    expect(service.isLoggedIn()).toBe(true);
    expect(service.hasValidSession()).toBe(true);
    expect(localStorage.getItem('forgedb.token')).toBe(token);
    expect(localStorage.getItem('forgedb.user')).toBe(JSON.stringify(storedUser));
  });

  it('clears both persisted values when the JWT is expired', () => {
    persistSession(jwtWithExpiry(Math.floor(Date.now() / 1000) - 60));

    const service = TestBed.inject(AuthService);

    expect(service.token()).toBeNull();
    expect(service.user()).toBeNull();
    expect(service.isLoggedIn()).toBe(false);
    expect(service.hasValidSession()).toBe(false);
    expect(localStorage.getItem('forgedb.token')).toBeNull();
    expect(localStorage.getItem('forgedb.user')).toBeNull();
  });

  it('clears both persisted values when the stored token is not a readable JWT', () => {
    persistSession('malformed-token');

    const service = TestBed.inject(AuthService);

    expect(service.token()).toBeNull();
    expect(service.user()).toBeNull();
    expect(service.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('forgedb.token')).toBeNull();
    expect(localStorage.getItem('forgedb.user')).toBeNull();
  });

  function persistSession(token: string): void {
    localStorage.setItem('forgedb.token', token);
    localStorage.setItem('forgedb.user', JSON.stringify(storedUser));
  }

  function jwtWithExpiry(exp: number): string {
    return [
      encode({ alg: 'none', typ: 'JWT' }),
      encode({ sub: String(storedUser.id), exp }),
      'unsigned-test-signature',
    ].join('.');
  }

  function encode(value: object): string {
    return btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
});
