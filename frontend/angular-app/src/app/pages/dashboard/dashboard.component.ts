import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface StatCard {
  label: string;
  value: number;
  change: string;
  icon: string;
  tone: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  readonly stats: StatCard[] = [
    { label: 'Total Projects', value: 12, change: '20% vs last month', icon: 'M4 7.5h5l1.5 2H20v9H4v-11Z', tone: 'bg-violet-50 text-violet-600' },
    { label: 'Analyses Completed', value: 24, change: '18% vs last month', icon: 'M4 18V9m5 9V5m5 13v-7m5 7V3', tone: 'bg-emerald-50 text-emerald-600' },
    { label: 'Schemas Generated', value: 18, change: '15% vs last month', icon: 'M4.5 5.25h15v13.5h-15V5.25Zm0 4.5h15M9 5.25v13.5', tone: 'bg-amber-50 text-amber-600' },
    { label: 'Deployments', value: 9, change: '12% vs last month', icon: 'm12 3 4.5 4.5L12 12 7.5 7.5 12 3Zm0 9v8.5m-5-4.5 5 4.5 5-4.5', tone: 'bg-blue-50 text-blue-600' },
  ];

  readonly projects = [
    { name: 'Sales Data Project', sources: 3, date: 'May 16, 2026', schema: 'Generated', deployment: 'Deployed' },
    { name: 'Inventory System', sources: 2, date: 'May 15, 2026', schema: 'Generated', deployment: 'Deployed' },
    { name: 'Customer Insights', sources: 1, date: 'May 14, 2026', schema: 'In Review', deployment: 'Not Deployed' },
    { name: 'HR Analytics', sources: 2, date: 'May 13, 2026', schema: 'Generated', deployment: 'Deployed' },
    { name: 'E-commerce Data', sources: 4, date: 'May 12, 2026', schema: 'In Review', deployment: 'Not Deployed' },
  ];

  readonly activities = [
    { text: 'Analysis completed for Sales_Data_Project', time: '10 min ago', tone: 'bg-emerald-50 text-emerald-600', icon: '✓' },
    { text: 'Database deployed for Inventory_System', time: '1 hour ago', tone: 'bg-violet-50 text-violet-600', icon: 'DB' },
    { text: 'Schema generated for HR_Analytics', time: '2 hours ago', tone: 'bg-amber-50 text-amber-600', icon: 'S' },
    { text: 'File uploaded to Customer_Insights', time: '3 hours ago', tone: 'bg-blue-50 text-blue-600', icon: '↑' },
  ];
}
