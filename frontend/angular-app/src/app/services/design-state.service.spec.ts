import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { DesignStateService } from './design-state.service';
import { DesignApiService } from './design-api.service';
import { DesignModelResponse } from './api.models';

function makeDesign(overrides: Partial<DesignModelResponse> = {}): DesignModelResponse {
  return {
    id: 1,
    projectId: 10,
    revision: 1,
    layout: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    tables: [
      {
        id: 100,
        name: 'orders',
        comment: null,
        sourceDatasetId: 5,
        origin: 'generated',
        columns: [
          { id: 200, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: true, ordinal: 0, sourceColumnName: 'id', origin: 'generated' },
        ],
      },
    ],
    relationships: [],
    validationIssues: [],
    ...overrides,
  };
}

function conflictError(currentRevision: number) {
  return { status: 409, error: { currentRevision, message: 'Design has been modified since revision was read.' } };
}

describe('DesignStateService', () => {
  let api: {
    getDesign: ReturnType<typeof vi.fn>;
    getPreview: ReturnType<typeof vi.fn>;
    updateTable: ReturnType<typeof vi.fn>;
    generateDesign: ReturnType<typeof vi.fn>;
    isRevisionConflict: (err: unknown) => boolean;
  };
  let service: DesignStateService;

  beforeEach(() => {
    vi.useFakeTimers();
    api = {
      getDesign: vi.fn(() => of(makeDesign())),
      getPreview: vi.fn(() => of('')),
      updateTable: vi.fn(),
      generateDesign: vi.fn(() => of(makeDesign())),
      isRevisionConflict: (err: unknown) => typeof err === 'object' && err !== null && (err as { status?: number }).status === 409,
    };
    service = new DesignStateService(api as unknown as DesignApiService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the design and exposes its revision', () => {
    service.loadForProject(10).subscribe();
    expect(service.revision()).toBe(1);
    expect(service.tables()[0].name).toBe('orders');
  });

  it('updates the stored revision and snapshot from the server response on a successful mutation', () => {
    service.loadForProject(10).subscribe();

    const updated = makeDesign({ revision: 2, tables: [{ ...makeDesign().tables[0], name: 'orders_v2' }] });
    api.updateTable.mockReturnValue(of(updated));

    service.updateTable(100, { name: 'orders_v2' }).subscribe();

    expect(service.revision()).toBe(2);
    expect(service.tables()[0].name).toBe('orders_v2');
    expect(api.updateTable).toHaveBeenCalledWith(100, 1, { name: 'orders_v2', comment: null });
  });

  it('shows the optimistic value immediately, then rolls back the field on failure', () => {
    service.loadForProject(10).subscribe();
    expect(service.tables()[0].name).toBe('orders');

    api.updateTable.mockReturnValue(throwError(() => ({ status: 500, error: { message: 'boom' } })));

    const obs = service.updateTable(100, { name: 'renamed-optimistically' });
    // Optimistic patch is applied as soon as the mutation is issued, before the (cold) HTTP
    // observable is even subscribed — this is what lets the UI show the new value immediately.
    expect(service.tables()[0].name).toBe('renamed-optimistically');

    obs.subscribe({ error: () => undefined });

    // Failure rolls the field back and surfaces a non-conflict error instead.
    expect(service.tables()[0].name).toBe('orders');
    expect(service.revision()).toBe(1);
    expect(service.conflict()).toBe(false);
    expect(service.error()).toBe('boom');
  });

  it('sets conflict (not a silent retry) on a 409 and leaves the snapshot at the last known-good revision', () => {
    service.loadForProject(10).subscribe();
    api.updateTable.mockReturnValue(throwError(() => conflictError(7)));

    service.updateTable(100, { name: 'x' }).subscribe({ error: () => undefined });

    expect(service.conflict()).toBe(true);
    expect(service.revision()).toBe(1); // unchanged — no silent overwrite/retry occurred
    expect(api.updateTable).toHaveBeenCalledTimes(1); // exactly one attempt, never retried
  });

  it('reload() clears a pending conflict and refetches the design', () => {
    service.loadForProject(10).subscribe();
    api.updateTable.mockReturnValue(throwError(() => conflictError(7)));
    service.updateTable(100, { name: 'x' }).subscribe({ error: () => undefined });
    expect(service.conflict()).toBe(true);

    api.getDesign.mockReturnValue(of(makeDesign({ revision: 7 })));
    service.reload().subscribe();

    expect(service.conflict()).toBe(false);
    expect(service.revision()).toBe(7);
  });

  it('treats a 428 (missing If-Match) as a conflict and logs it as a bug', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    service.loadForProject(10).subscribe();
    api.updateTable.mockReturnValue(throwError(() => ({ status: 428, error: { message: 'If-Match required' } })));

    service.updateTable(100, { name: 'x' }).subscribe({ error: () => undefined });

    expect(service.conflict()).toBe(true);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('generate() sends If-Match with the held revision once a design is loaded', () => {
    service.loadForProject(10).subscribe();
    api.generateDesign.mockReturnValue(of(makeDesign({ revision: 2 })));

    service.generate('merge').subscribe();

    expect(api.generateDesign).toHaveBeenCalledWith(10, 'merge', 1);
    expect(service.revision()).toBe(2);
  });

  it('generate() sends no revision for the empty-state call (no design loaded yet)', () => {
    api.getDesign.mockReturnValue(throwError(() => ({ status: 404 })));
    service.loadForProject(10).subscribe();
    expect(service.design()).toBeNull();

    service.generate('merge').subscribe();

    expect(api.generateDesign).toHaveBeenCalledWith(10, 'merge', undefined);
  });

  it('generate() treats a 409 the same as any other mutation conflict, not a silent retry', () => {
    service.loadForProject(10).subscribe();
    api.generateDesign.mockReturnValue(throwError(() => conflictError(5)));

    service.generate('merge').subscribe({ error: () => undefined });

    expect(service.conflict()).toBe(true);
    expect(service.revision()).toBe(1); // unchanged
  });

  it('never fetches a preview until after the mutation that motivated it has committed', () => {
    service.loadForProject(10).subscribe();
    vi.advanceTimersByTime(500);
    api.getPreview.mockClear();

    let revisionSeenByPreviewFetch: number | null = null;
    api.getPreview.mockImplementation(() => {
      revisionSeenByPreviewFetch = service.revision();
      return of('SQL');
    });

    const updated = makeDesign({ revision: 2 });
    api.updateTable.mockReturnValue(of(updated));
    service.updateTable(100, { name: 'orders' }).subscribe();

    // Design already updated synchronously; preview fetch is merely debounced, not yet fired.
    expect(service.revision()).toBe(2);
    expect(api.getPreview).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(api.getPreview).toHaveBeenCalled();
    expect(revisionSeenByPreviewFetch).toBe(2); // never fetched against the stale, pre-mutation revision
  });

  it('debounces rapid successive mutations into a single trailing preview fetch', () => {
    service.loadForProject(10).subscribe();
    vi.advanceTimersByTime(500);
    api.getPreview.mockClear();

    api.updateTable.mockReturnValueOnce(of(makeDesign({ revision: 2 })));
    service.updateTable(100, { name: 'a' }).subscribe();
    vi.advanceTimersByTime(200);

    api.updateTable.mockReturnValueOnce(of(makeDesign({ revision: 3 })));
    service.updateTable(100, { name: 'b' }).subscribe();
    vi.advanceTimersByTime(500);

    // Two mutations, but only one trailing preview fetch per format.
    const sqlCalls = api.getPreview.mock.calls.filter((call: unknown[]) => call[1] === 'sql');
    expect(sqlCalls.length).toBe(1);
    expect(service.revision()).toBe(3);
  });
});
