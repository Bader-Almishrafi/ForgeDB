import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignModelResponse } from '../../services/api.models';
import { DesignApiService } from '../../services/design-api.service';
import { ForgeApiService } from '../../services/forge-api.service';
import { WorkflowStateService } from '../../services/workflow-state.service';
import { ProjectErDiagramComponent } from './project-er-diagram.component';

const schema: DesignModelResponse = {
  id: 4, projectId: 10, revision: 3, status: 'Valid', layout: null, createdAt: '', updatedAt: '', validationIssues: [],
  tables: [
    { id: 1, name: 'customers', origin: 'generated', columns: [
      { id: 11, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, origin: 'generated' },
      { id: 12, name: 'name', sqlType: 'TEXT', isNullable: false, isPrimaryKey: false, isUnique: false, ordinal: 1, origin: 'generated' },
    ] },
    { id: 2, name: 'orders', origin: 'generated', columns: [
      { id: 21, name: 'id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: true, isUnique: false, ordinal: 0, origin: 'generated' },
      { id: 22, name: 'customer_id', sqlType: 'INTEGER', isNullable: false, isPrimaryKey: false, isUnique: false, ordinal: 1, origin: 'generated' },
    ] },
  ],
  relationships: [{
    id: 30, fromColumnId: 22, fromTableId: 2, fromTableName: 'orders', fromColumnName: 'customer_id',
    toColumnId: 11, toTableId: 1, toTableName: 'customers', toColumnName: 'id',
    cardinality: 'many-to-one', onDelete: 'no-action', origin: 'user',
  }],
};

describe('ProjectErDiagramComponent panning', () => {
  let fixture: ComponentFixture<ProjectErDiagramComponent>;
  let component: ProjectErDiagramComponent;
  let viewport: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectErDiagramComponent],
      providers: [
        provideRouter([]),
        { provide: ForgeApiService, useValue: { getProject: vi.fn(() => of({ id: 10, userId: 1, name: 'ER Project', createdAt: '' })) } },
        { provide: DesignApiService, useValue: { getDesign: vi.fn(() => of(structuredClone(schema))) } },
        { provide: WorkflowStateService, useValue: { setProjectId: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ projectId: '10' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectErDiagramComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    viewport = fixture.nativeElement.querySelector('[data-testid="er-pan-viewport"]') as HTMLElement;
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 390 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 });
  });

  function pointer(type: string, x: number, y: number, pointerId = 1, pointerType = 'mouse'): Event {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, {
      pointerId: { configurable: true, value: pointerId },
      pointerType: { configurable: true, value: pointerType },
    });
    return event;
  }

  function drag(target: Element, pointerType = 'mouse'): void {
    target.dispatchEvent(pointer('pointerdown', 300, 300, 1, pointerType));
    target.dispatchEvent(pointer('pointermove', 140, 180, 1, pointerType));
    target.dispatchEvent(pointer('pointerup', 140, 180, 1, pointerType));
    fixture.detectChanges();
  }

  it('mouse pointer drag changes the pan translation and cursor state', () => {
    viewport.dispatchEvent(pointer('pointerdown', 300, 300));
    fixture.detectChanges();
    expect(component.panning()).toBe(true);
    expect(viewport.classList.contains('cursor-grabbing')).toBe(true);
    viewport.dispatchEvent(pointer('pointermove', 140, 180));
    viewport.dispatchEvent(pointer('pointerup', 140, 180));
    fixture.detectChanges();

    expect(component.panX()).toBe(-160);
    expect(component.panY()).toBe(-120);
    expect(component.diagramTransform()).toContain('translate3d(-160px, -120px');
    expect(component.panning()).toBe(false);
  });

  it('touch pointer drag pans through the same pointer-capture path', () => {
    drag(viewport, 'touch');
    expect(component.panX()).toBe(-160);
    expect(component.panY()).toBe(-120);
  });

  it('does not select a node when the gesture was a pan', () => {
    const node = fixture.nativeElement.querySelector('foreignObject') as Element;
    drag(node);
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(component.selectedNode()).toBeNull();
  });

  it('Reset View restores initial translation and zoom', () => {
    drag(viewport);
    component.zoomIn();
    fixture.detectChanges();
    expect(component.zoom()).toBe(110);
    (fixture.nativeElement.querySelector('[data-testid="reset-er-view"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.zoom()).toBe(100);
    expect(component.panX()).toBe(0);
    expect(component.panY()).toBe(0);
  });

  it('zoom continues to work after pan and preserves the translated canvas', () => {
    drag(viewport);
    const panBefore = component.panX();
    component.zoomIn();
    fixture.detectChanges();
    expect(component.zoom()).toBe(110);
    expect(component.panX()).toBe(panBefore);
    expect((fixture.nativeElement.querySelector('[data-testid="er-pan-surface"]') as HTMLElement).style.transform).toContain('scale(1.1)');
  });

  it('retains pan, zoom, reset, and helper controls at a 390px viewport', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();
    expect(viewport.getAttribute('aria-label')).toContain('Drag');
    expect(fixture.nativeElement.querySelector('[data-testid="reset-er-view"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#er-pan-help').textContent).toContain('mouse or touch');
    expect(viewport.classList.contains('overflow-hidden')).toBe(true);
  });
});
