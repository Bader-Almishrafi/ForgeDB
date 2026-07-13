import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiErrorBody, ProjectExportPackage } from '../../services/api.models';
import { ForgeApiService } from '../../services/forge-api.service';
import { SchemaExportService } from '../../services/schema-export.service';
import { WorkflowStateService } from '../../services/workflow-state.service';

@Component({
  selector: 'app-project-exports',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink],
  templateUrl: './project-exports.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectExportsComponent implements OnInit {
  readonly exportPackage = signal<ProjectExportPackage | null>(null);
  readonly loading = signal(false);
  readonly copiedTarget = signal<'sql' | 'dbml' | null>(null);

  projectId = 0;
  errorMessage = '';

  constructor(
    private api: ForgeApiService,
    private route: ActivatedRoute,
    private router: Router,
    private schemaExport: SchemaExportService,
    private workflow: WorkflowStateService,
  ) {}

  ngOnInit(): void {
    this.projectId = Number(this.route.snapshot.paramMap.get('projectId'));
    if (!Number.isFinite(this.projectId) || this.projectId <= 0) {
      this.router.navigate(['/projects']);
      return;
    }

    this.workflow.setProjectId(this.projectId);
    this.loadPackage();
  }

  loadPackage(): void {
    this.errorMessage = '';
    this.loading.set(true);

    this.api.getProjectExportPackage(this.projectId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (exportPackage) => this.exportPackage.set(exportPackage),
        error: (error: { error?: ApiErrorBody }) => {
          this.errorMessage = error.error?.message ?? 'Unable to load export package.';
        },
      });
  }

  download(fileName: string, content: string, mimeType: string): void {
    this.schemaExport.downloadText(fileName, content, mimeType);
  }

  copy(content: string, target: 'sql' | 'dbml'): void {
    navigator.clipboard.writeText(content)
      .then(() => {
        this.copiedTarget.set(target);
        window.setTimeout(() => this.copiedTarget.set(null), 2000);
      })
      .catch(() => {
        this.errorMessage = 'Unable to copy in this browser.';
      });
  }
}
