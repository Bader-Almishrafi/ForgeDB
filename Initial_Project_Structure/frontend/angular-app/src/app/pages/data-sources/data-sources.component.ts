import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-data-sources',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './data-sources.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataSourcesComponent {
  readonly activeTab = signal<'file' | 'api'>('file');
  readonly selectedFileName = signal<string>('');
  apiUrl = 'https://api.example.com/v1/data';
  authType = 'Bearer Token';
  token = '';
  headerName = 'Authorization';

  readonly files = [
    { name: 'sales_data.csv', type: 'CSV', size: '2.4 MB', date: 'May 16, 2026 10:30 AM', status: 'Ready' },
    { name: 'customers.xlsx', type: 'Excel', size: '1.8 MB', date: 'May 16, 2026 10:25 AM', status: 'Ready' },
    { name: 'products.csv', type: 'CSV', size: '950 KB', date: 'May 16, 2026 10:25 AM', status: 'Ready' },
  ];

  selectTab(tab: 'file' | 'api'): void {
    this.activeTab.set(tab);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFileName.set(input.files?.[0]?.name ?? '');
  }
}
