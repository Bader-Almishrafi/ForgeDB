import { RedirectFunction, Routes } from '@angular/router';
import { authGuard } from './services/auth.guard';
import { projectWorkflowGuard } from './services/project-workflow.guard';
import { unsavedChangesGuard } from './services/unsaved-changes.guard';

const legacyDatasetRedirect = (step: 'data' | 'analyze'): RedirectFunction =>
  (route) => {
    const projectId = Number(route.queryParams['returnProject']);
    const datasetId = Number(route.params['datasetId']);
    if (!Number.isInteger(projectId) || projectId <= 0) return '/projects';
    const query = Number.isInteger(datasetId) && datasetId > 0 ? `?datasetId=${datasetId}` : '';
    return `/projects/${projectId}/${step}${query}`;
  };

export const routes: Routes = [
  { path: '', pathMatch: 'full', title: 'ForgeDB - Data-to-database workflow', loadComponent: () => import('./pages/landing/landing.component').then((module) => module.LandingComponent) },
  { path: 'login', title: 'Log In - ForgeDB', loadComponent: () => import('./pages/login/login.component').then((module) => module.LoginComponent) },
  { path: 'register', title: 'Create Account - ForgeDB', loadComponent: () => import('./pages/signup/signup.component').then((module) => module.SignupComponent) },
  { path: 'signup', redirectTo: 'register', pathMatch: 'full' },
  { path: 'app', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/dashboard', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/projects', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/data-sources', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'app/analysis', redirectTo: 'projects', pathMatch: 'full' },
  { path: 'datasets/:datasetId/preview', redirectTo: legacyDatasetRedirect('data') },
  { path: 'datasets/:datasetId/explorer', redirectTo: legacyDatasetRedirect('analyze') },
  { path: 'datasets/:datasetId/analyze', redirectTo: legacyDatasetRedirect('analyze') },
  { path: 'datasets/:datasetId/dashboard', redirectTo: legacyDatasetRedirect('analyze') },
  { path: 'datasets/:datasetId/profile', redirectTo: legacyDatasetRedirect('analyze') },
  {
    path: '',
    loadComponent: () => import('./layout/app-shell.component').then((module) => module.AppShellComponent),
    canActivateChild: [authGuard],
    children: [
      { path: 'home', title: 'Workspace - ForgeDB', loadComponent: () => import('./pages/home/home.component').then((module) => module.HomeComponent) },
      { path: 'projects', title: 'All Projects - ForgeDB', loadComponent: () => import('./pages/projects/projects.component').then((module) => module.ProjectsComponent) },
      { path: 'projects/new', title: 'Create Project - ForgeDB', loadComponent: () => import('./pages/project-create/project-create.component').then((module) => module.ProjectCreateComponent), canDeactivate: [unsavedChangesGuard] },
      { path: 'change-password', title: 'Change Password - ForgeDB', loadComponent: () => import('./pages/change-password/change-password.component').then((module) => module.ChangePasswordComponent) },
    ],
  },
  {
    path: 'projects/:projectId',
    loadComponent: () => import('./layout/project-workflow-shell.component').then((module) => module.ProjectWorkflowShellComponent),
    canActivateChild: [authGuard],
    children: [
      { path: '', redirectTo: 'data', pathMatch: 'full' },
      { path: 'data', title: 'Data Sources - ForgeDB', loadComponent: () => import('./pages/data-sources/data-sources.component').then((module) => module.DataSourcesComponent), canActivate: [projectWorkflowGuard] },
      { path: 'analyze', title: 'Data Analysis - ForgeDB', loadComponent: () => import('./pages/analyze-data/analyze-data.component').then((module) => module.AnalyzeDataComponent), canActivate: [projectWorkflowGuard] },
      { path: 'clean', title: 'Data Cleaning - ForgeDB', loadComponent: () => import('./pages/data-cleaning/data-cleaning.component').then((module) => module.DataCleaningComponent), canActivate: [projectWorkflowGuard] },
      { path: 'schema', title: 'Schema Designer - ForgeDB', loadComponent: () => import('./pages/project-schema-designer/project-schema-designer.component').then((module) => module.ProjectSchemaDesignerComponent), canActivate: [projectWorkflowGuard], canDeactivate: [unsavedChangesGuard] },
      { path: 'export-deploy', title: 'Export & Deploy - ForgeDB', loadComponent: () => import('./pages/export-deploy/export-deploy.component').then((module) => module.ExportDeployComponent), canActivate: [projectWorkflowGuard] },

      { path: 'overview', redirectTo: 'data', pathMatch: 'full' },
      { path: 'datasets', redirectTo: 'data', pathMatch: 'full' },
      { path: 'upload', redirectTo: 'data', pathMatch: 'full' },
      { path: 'analysis', redirectTo: 'analyze', pathMatch: 'full' },
      { path: 'data-cleaning', redirectTo: 'clean', pathMatch: 'full' },
      { path: 'schema-designer', redirectTo: 'schema', pathMatch: 'full' },
      { path: 'relationships', redirectTo: 'schema', pathMatch: 'full' },
      { path: 'exports', redirectTo: 'export-deploy', pathMatch: 'full' },
      { path: 'deployment', redirectTo: 'export-deploy', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: '' },
];
