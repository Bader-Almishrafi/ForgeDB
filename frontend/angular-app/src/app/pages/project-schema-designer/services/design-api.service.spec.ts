import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DesignApiService } from './design-api.service';

describe('DesignApiService revision conflict detection', () => {
  let service: DesignApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), DesignApiService],
    });
    service = TestBed.inject(DesignApiService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('recognizes a stale revision response by its current revision metadata', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { currentRevision: 7, message: 'The schema changed.' },
    });

    expect(service.isRevisionConflict(error)).toBe(true);
  });

  it('does not treat a relationship business conflict as a revision conflict', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'This relationship already exists.' },
    });

    expect(service.isRevisionConflict(error)).toBe(false);
  });

  it('does not treat non-conflict responses as revision conflicts', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { currentRevision: 7, message: 'Invalid relationship.' },
    });

    expect(service.isRevisionConflict(error)).toBe(false);
  });
});
