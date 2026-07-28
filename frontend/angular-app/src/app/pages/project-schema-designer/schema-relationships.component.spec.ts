import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DesignModelResponse,
  DesignRelationship,
} from '../../services/api.models';
import { SchemaRelationshipsComponent } from './schema-relationships.component';
import { DesignApiService } from './services/design-api.service';

const relationship: DesignRelationship = {
  id: 31,
  fromColumnId: 11,
  fromTableId: 1,
  fromTableName: 'orders',
  fromColumnName: 'customer_id',
  toColumnId: 21,
  toTableId: 2,
  toTableName: 'customers',
  toColumnName: 'id',
  cardinality: 'many-to-one',
  onDelete: 'no-action',
  origin: 'manual',
  suggestionId: null,
};

const design = (relationships: DesignRelationship[] = []): DesignModelResponse => ({
  id: 20,
  projectId: 10,
  revision: 4,
  status: 'Draft',
  layout: null,
  createdAt: '2026-07-20T09:00:00Z',
  updatedAt: '2026-07-20T09:05:00Z',
  tables: [
    {
      id: 1,
      name: 'orders',
      origin: 'generated',
      columns: [{
        id: 11,
        name: 'customer_id',
        sqlType: 'INTEGER',
        isNullable: false,
        isPrimaryKey: false,
        isUnique: false,
        ordinal: 0,
        origin: 'generated',
      }],
    },
    {
      id: 2,
      name: 'customers',
      origin: 'generated',
      columns: [{
        id: 21,
        name: 'id',
        sqlType: 'INTEGER',
        isNullable: false,
        isPrimaryKey: true,
        isUnique: true,
        ordinal: 0,
        origin: 'generated',
      }],
    },
  ],
  relationships,
  validationIssues: [],
});

describe('SchemaRelationshipsComponent', () => {
  let fixture: ComponentFixture<SchemaRelationshipsComponent>;
  let component: SchemaRelationshipsComponent;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    api = {
      getSuggestions: vi.fn(() => of([])),
      createRelationship: vi.fn(),
      deleteRelationship: vi.fn(),
      getSchema: vi.fn(),
      isRevisionConflict: vi.fn(() => false),
    };

    await TestBed.configureTestingModule({
      imports: [SchemaRelationshipsComponent],
      providers: [{ provide: DesignApiService, useValue: api }],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('creates a valid manual relationship and emits the refreshed design', () => {
    const initial = design();
    const refreshed = { ...design([relationship]), revision: 5 };
    api['createRelationship'].mockReturnValue(of(refreshed));
    createFixture(initial);
    api['getSchema'].mockReturnValue(of(refreshed));
    const changed = vi.fn();
    const busyChanged = vi.fn();
    component.designChanged.subscribe(changed);
    component.mutationBusyChange.subscribe(busyChanged);

    component.updateManualDraft({ fromTableId: 1 });
    component.updateManualDraft({ fromColumnId: 11 });
    component.updateManualDraft({ toTableId: 2 });
    component.updateManualDraft({ toColumnId: 21, cardinality: 'many-to-one', onDelete: 'cascade' });
    expect(component.manualValidationMessage()).toBe('');

    component.createManualRelationship();

    expect(api['createRelationship']).toHaveBeenCalledWith(20, 4, {
      fromColumnId: 11,
      toColumnId: 21,
      cardinality: 'many-to-one',
      onDelete: 'cascade',
    });
    expect(api['getSchema']).toHaveBeenCalledWith(10);
    expect(changed).toHaveBeenCalledWith(refreshed);
    expect(busyChanged.mock.calls.map(([busy]) => busy)).toEqual([true, false]);
    expect(component.manualDraft()).toEqual({
      fromTableId: null,
      fromColumnId: null,
      toTableId: null,
      toColumnId: null,
      cardinality: 'many-to-one',
      onDelete: 'no-action',
    });
    expect(component.feedback()?.title).toBe('Relationship created');
  });

  it('locks relationship drafts to the submitted snapshot while a mutation is in progress', () => {
    const request = new Subject<DesignModelResponse>();
    const refreshed = { ...design([relationship]), revision: 5 };
    api['createRelationship'].mockReturnValue(request);
    createFixture(design());
    api['getSchema'].mockReturnValue(of(refreshed));
    component.updateManualDraft({ fromTableId: 1 });
    component.updateManualDraft({ fromColumnId: 11 });
    component.updateManualDraft({ toTableId: 2 });
    component.updateManualDraft({ toColumnId: 21 });

    component.createManualRelationship();
    fixture.detectChanges();

    const editors = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="manual-relationship-form"] select'),
    ) as HTMLSelectElement[];
    expect(component.formControlsDisabled()).toBe(true);
    expect(editors.filter((editor) => !editor.matches(':disabled')).map((editor) => editor.dataset['testid'])).toEqual([]);

    component.updateManualDraft({ onDelete: 'cascade' });
    expect(component.manualDraft().onDelete).toBe('no-action');

    request.next(refreshed);
    request.complete();
  });

  it('reports an accepted relationship change as refresh-required when follow-up loading fails', () => {
    const refreshed = { ...design([relationship]), revision: 5 };
    api['createRelationship'].mockReturnValue(of(refreshed));
    createFixture(design());
    api['getSchema'].mockReturnValue(throwError(() => new Error('refresh unavailable')));
    const reloadRequired = vi.fn();
    component.revisionConflict.subscribe(reloadRequired);
    component.updateManualDraft({ fromTableId: 1 });
    component.updateManualDraft({ fromColumnId: 11 });
    component.updateManualDraft({ toTableId: 2 });
    component.updateManualDraft({ toColumnId: 21 });

    component.createManualRelationship();

    expect(api['createRelationship']).toHaveBeenCalledOnce();
    expect(reloadRequired).toHaveBeenCalledOnce();
    expect(component.feedback()).toEqual({
      kind: 'warning',
      title: 'Relationship created; refresh required',
      message: 'The change was accepted, but the latest schema could not be reloaded. Reload before changing relationships again.',
    });
    expect(component.manualDraft().fromTableId).toBe(1);
  });

  it('opens a destructive confirmation on Cancel and restores focus after Escape', async () => {
    createFixture(design([relationship]));
    const deleteButton = rowDeleteButton();
    deleteButton.focus();

    deleteButton.click();
    fixture.detectChanges();
    await flushFocus();

    const dialog = fixture.nativeElement.querySelector('[role="alertdialog"]') as HTMLElement;
    const cancel = dialog.querySelector('.btn-secondary') as HTMLButtonElement;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Delete relationship?');
    expect(api['deleteRelationship']).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(cancel);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await flushFocus();

    expect(component.deleteTarget()).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
    expect(api['deleteRelationship']).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(deleteButton);
  });

  it('deletes only after confirmation and restores focus to the persistent heading', async () => {
    const refreshed = { ...design(), revision: 5 };
    api['deleteRelationship'].mockReturnValue(of(refreshed));
    createFixture(design([relationship]));
    api['getSchema'].mockReturnValue(of(refreshed));
    const changed = vi.fn();
    component.designChanged.subscribe(changed);
    const deleteButton = rowDeleteButton();
    deleteButton.focus();
    deleteButton.click();
    fixture.detectChanges();
    await flushFocus();

    const confirm = fixture.nativeElement.querySelector(
      '[data-testid="confirm-delete-relationship"]',
    ) as HTMLButtonElement;
    confirm.click();
    fixture.detectChanges();
    await flushFocus();

    expect(api['deleteRelationship']).toHaveBeenCalledOnce();
    expect(api['deleteRelationship']).toHaveBeenCalledWith(31, 4);
    expect(changed).toHaveBeenCalledWith(refreshed);
    expect(component.deleteTarget()).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement?.textContent).toContain('Relationships');
    expect(component.feedback()?.title).toBe('Relationship deleted');
  });

  it('keeps focus inside the confirmation while deletion is in progress', async () => {
    const request = new Subject<DesignModelResponse>();
    const refreshed = { ...design(), revision: 5 };
    api['deleteRelationship'].mockReturnValue(request);
    createFixture(design([relationship]));
    api['getSchema'].mockReturnValue(of(refreshed));
    rowDeleteButton().click();
    fixture.detectChanges();
    await flushFocus();

    (fixture.nativeElement.querySelector(
      '[data-testid="confirm-delete-relationship"]',
    ) as HTMLButtonElement).click();
    fixture.detectChanges();
    await flushFocus();
    const dialog = fixture.nativeElement.querySelector('[role="alertdialog"]') as HTMLElement;

    expect(component.deleteTarget()).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    }));
    expect(document.activeElement).toBe(dialog);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }));
    expect(component.deleteTarget()).not.toBeNull();

    request.next(refreshed);
    request.complete();
  });

  function createFixture(model: DesignModelResponse): void {
    api['getSchema'].mockReturnValue(of(model));
    fixture = TestBed.createComponent(SchemaRelationshipsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('projectId', 10);
    fixture.componentRef.setInput('design', model);
    fixture.detectChanges();
  }

  function rowDeleteButton(): HTMLButtonElement {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="accepted-relationships-table"] button'),
    ) as HTMLButtonElement[];
    return buttons.find((button) => button.textContent?.trim() === 'Delete')!;
  }

  async function flushFocus(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
});
