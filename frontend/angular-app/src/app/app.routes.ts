import { Routes } from '@angular/router';
import { authGuard } from './services/auth.guard';
import { unsavedChangesGuard } from './services/unsaved-changes.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./pages/landing/landing.component').then((module) => module.LandingComponent) },
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then((module) => module.LoginComponent) },
  { path: 'register', loadComponent: () => import('./pages/signup/signup.component').then((module) => module.SignupComponent) },
  { path: 'signup', redirectTo: 'register', pathMatch: 'full' },
  { path: 'app', redirectTo: 'home', pathMatch: 'full' },
  { path: 'app/dashboard', redirectTo: 'home', pathMatch: 'full' },
  { path: 'app/projects', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/data-sources', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/analysis', redirectTo: 'projects', pathMatch: 'full' },
  {
    path: '',
    loadComponent: () => import('./layout/app-shell.component').then((module) => module.AppShellComponent),
    canActivateChild: [authGuard],
    children: [
      { path: 'home', loadComponent: () => import('./pages/home/home.component').then((module) => module.HomeComponent) },
      { path: 'change-password', loadComponent: () => import('./pages/change-password/change-password.component').then((module) => module.ChangePasswordComponent) },
      { path: 'projects', loadComponent: () => import('./pages/projects/projects.component').then((module) => module.ProjectsComponent) },
      { path: 'projects/new', loadComponent: () => import('./pages/project-create/project-create.component').then((module) => module.ProjectCreateComponent), canDeactivate: [unsavedChangesGuard] },
      { path: 'projects/:projectId/overview', loadComponent: () => import('./pages/project-overview/project-overview.component').then((module) => module.ProjectOverviewComponent) },
      { path: 'projects/:projectId/datasets', loadComponent: () => import('./pages/data-sources/data-sources.component').then((module) => module.DataSourcesComponent) },
      { path: 'projects/:projectId/upload', loadComponent: () => import('./pages/data-sources/data-sources.component').then((module) => module.DataSourcesComponent) },
      { path: 'projects/:projectId/analysis', loadComponent: () => import('./pages/analyze-data/analyze-data.component').then((module) => module.AnalyzeDataComponent) },
      { path: 'projects/:projectId/data-cleaning', loadComponent: () => import('./pages/data-cleaning/data-cleaning.component').then((module) => module.DataCleaningComponent) },
      { path: 'projects/:projectId/relationships', loadComponent: () => import('./pages/project-relationships/project-relationships.component').then((module) => module.ProjectRelationshipsComponent) },
      { path: 'projects/:projectId/schema-designer', loadComponent: () => import('./pages/project-schema-designer/project-schema-designer.component').then((module) => module.ProjectSchemaDesignerComponent), canDeactivate: [unsavedChangesGuard] },
      { path: 'projects/:projectId/er-diagram', redirectTo: 'projects/:projectId/relationships', pathMatch: 'full' },
      { path: 'projects/:projectId/deployment', loadComponent: () => import('./pages/project-deployment/project-deployment.component').then((module) => module.ProjectDeploymentComponent) },
      { path: 'projects/:projectId/exports', loadComponent: () => import('./pages/project-exports/project-exports.component').then((module) => module.ProjectExportsComponent) },
      { path: 'datasets/:datasetId/preview', loadComponent: () => import('./pages/analysis/analysis.component').then((module) => module.AnalysisComponent) },
      { path: 'datasets/:datasetId/explorer', loadComponent: () => import('./pages/analysis/analysis.component').then((module) => module.AnalysisComponent) },
      { path: 'datasets/:datasetId/analyze', loadComponent: () => import('./pages/analyze-data/analyze-data.component').then((module) => module.AnalyzeDataComponent) },
      { path: 'datasets/:datasetId/dashboard', loadComponent: () => import('./pages/dashboard/dashboard.component').then((module) => module.DashboardComponent) },
      { path: 'datasets/:datasetId/profile', loadComponent: () => import('./pages/dashboard/dashboard.component').then((module) => module.DashboardComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
