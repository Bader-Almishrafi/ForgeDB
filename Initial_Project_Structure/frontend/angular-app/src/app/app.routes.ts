import { Routes } from '@angular/router';
import { AppShellComponent } from './layout/app-shell.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { DataSourcesComponent } from './pages/data-sources/data-sources.component';
import { AnalysisComponent } from './pages/analysis/analysis.component';
import { SchemaReviewComponent } from './pages/schema-review/schema-review.component';
import { RelationshipsComponent } from './pages/relationships/relationships.component';
import { DeploymentComponent } from './pages/deployment/deployment.component';
import { PlaceholderComponent } from './pages/placeholder/placeholder.component';

export const routes: Routes = [
  {
    path: '',
    component: AppShellComponent,
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'data-sources', component: DataSourcesComponent },
      { path: 'analysis', component: AnalysisComponent },
      { path: 'schema-review', component: SchemaReviewComponent },
      { path: 'relationships', component: RelationshipsComponent },
      { path: 'deployment', component: DeploymentComponent },
      { path: 'projects', component: PlaceholderComponent, data: { title: 'Projects' } },
      { path: 'sql-scripts', component: PlaceholderComponent, data: { title: 'SQL Scripts' } },
      { path: 'settings', component: PlaceholderComponent, data: { title: 'Settings' } },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
