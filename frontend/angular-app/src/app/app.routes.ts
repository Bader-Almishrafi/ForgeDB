import { Routes } from '@angular/router';
import { AppShellComponent } from './layout/app-shell.component';
import { AnalyzeDataComponent } from './pages/analyze-data/analyze-data.component';
import { AnalysisComponent } from './pages/analysis/analysis.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { DataSourcesComponent } from './pages/data-sources/data-sources.component';
import { LandingComponent } from './pages/landing/landing.component';
import { LoginComponent } from './pages/login/login.component';
import { ProjectsComponent } from './pages/projects/projects.component';
import { ProjectErDiagramComponent } from './pages/project-er-diagram/project-er-diagram.component';
import { ProjectExportsComponent } from './pages/project-exports/project-exports.component';
import { ProjectOverviewComponent } from './pages/project-overview/project-overview.component';
import { ProjectRelationshipsComponent } from './pages/project-relationships/project-relationships.component';
import { ProjectSchemaDesignerComponent } from './pages/project-schema-designer/project-schema-designer.component';
import { SignupComponent } from './pages/signup/signup.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: LandingComponent },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: SignupComponent },
  { path: 'signup', redirectTo: 'register', pathMatch: 'full' },
  { path: 'app', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/dashboard', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/projects', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/data-sources', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/analysis', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/schema-review', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/relationships', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/deployment', redirectTo: 'projects', pathMatch: 'full' },
  {
    path: '',
    component: AppShellComponent,
    children: [
      { path: 'projects', component: ProjectsComponent },
      { path: 'projects/:projectId/overview', component: ProjectOverviewComponent },
      { path: 'projects/:projectId/datasets', component: DataSourcesComponent },
      { path: 'projects/:projectId/upload', component: DataSourcesComponent },
      { path: 'projects/:projectId/relationships', component: ProjectRelationshipsComponent },
      { path: 'projects/:projectId/schema-designer', component: ProjectSchemaDesignerComponent },
      { path: 'projects/:projectId/er-diagram', component: ProjectErDiagramComponent },
      { path: 'projects/:projectId/exports', component: ProjectExportsComponent },
      { path: 'datasets/:datasetId/preview', component: AnalysisComponent },
      { path: 'datasets/:datasetId/explorer', component: AnalysisComponent },
      { path: 'datasets/:datasetId/analyze', component: AnalyzeDataComponent },
      { path: 'datasets/:datasetId/dashboard', component: DashboardComponent },
      { path: 'datasets/:datasetId/profile', component: DashboardComponent },
    ],
  },
  { path: '**', redirectTo: '' },
];
