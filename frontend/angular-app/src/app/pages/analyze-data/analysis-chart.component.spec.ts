import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AnalysisChartComponent } from './analysis-chart.component';

describe('AnalysisChartComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AnalysisChartComponent] }).compileComponents();
  });

  function render(points: Array<{ label: string; value: number }>): ComponentFixture<AnalysisChartComponent> {
    const fixture = TestBed.createComponent(AnalysisChartComponent);
    fixture.componentRef.setInput('title', 'Missing values');
    fixture.componentRef.setInput('points', points);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a compact accessible bar list without configuration controls', () => {
    const fixture = render([{ label: 'customers.email', value: 20 }, { label: 'orders.note', value: 10 }]);
    expect(fixture.nativeElement.querySelectorAll('.chart-row')).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('customers.email');
    expect(fixture.nativeElement.querySelector('[role="img"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
  });

  it('renders a useful empty state', () => {
    const fixture = render([]);
    expect(fixture.nativeElement.textContent).toContain('No chart data is available');
  });
});
