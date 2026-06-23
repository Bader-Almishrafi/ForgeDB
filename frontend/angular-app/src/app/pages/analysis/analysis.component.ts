import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './analysis.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisComponent {
  readonly rows = [
    { id: 1, name: 'John Smith', email: 'john.smith@example.com', phone: '+1 (555) 123-4567', date: 'May 16, 2026 10:15 AM', amount: '1,250.00' },
    { id: 2, name: 'Sarah Johnson', email: 'sarah.johnson@example.com', phone: '+1 (555) 234-5678', date: 'May 16, 2026 10:20 AM', amount: '2,530.50' },
    { id: 3, name: 'Michael Brown', email: 'michael.brown@example.com', phone: '+1 (555) 345-6789', date: 'May 16, 2026 10:25 AM', amount: '980.75' },
    { id: 4, name: 'Emily Davis', email: 'emily.davis@example.com', phone: '+1 (555) 456-7890', date: 'May 16, 2026 10:30 AM', amount: '1,875.25' },
    { id: 5, name: 'David Wilson', email: 'david.wilson@example.com', phone: '+1 (555) 567-8901', date: 'May 16, 2026 10:35 AM', amount: '3,210.00' },
  ];
}
