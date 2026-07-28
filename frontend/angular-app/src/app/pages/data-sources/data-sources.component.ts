import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { DatasetResponse, ProjectResponse } from '../../services/api.models';
import { routeParameter } from '../../services/route-context';
import { DataSourcesService } from './services/data-sources.service';
import { EditProjectDialogComponent } from './dialogs/edit-project-dialog.component';
import { DeleteDatasetDialogComponent } from './dialogs/delete-dataset-dialog.component';
import { ReplaceDatasetDialogComponent } from './dialogs/replace-dataset-dialog.component';
import { ImportDatasetDialogComponent } from './dialogs/import-dataset-dialog.component';

type ImportSource = 'csv' | 'excel' | 'api';

@Component({
  selector: 'app-data-sources',
  standalone: true,
  imports: [DecimalPipe, FormsModule, EditProjectDialogComponent, DeleteDatasetDialogComponent, ReplaceDatasetDialogComponent, ImportDatasetDialogComponent],
  templateUrl: './data-sources.component.html',
  providers: [DataSourcesService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataSourcesComponent implements OnInit {
  readonly service = inject(DataSourcesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly pageHeading = viewChild<ElementRef<HTMLHeadingElement>>('pageHeading');
  private focusAfterImport = false;

  readonly importOpen = signal(false);
  readonly importSource = signal<ImportSource | null>(null);
  readonly replaceOpen = signal(false);
  readonly confirmingDelete = signal(false);
  readonly editOpen = signal(false);

  ngOnInit(): void {
    this.titleService.setTitle('Data Sources - ForgeDB');
    this.metaService.updateTag({ name: 'description', content: 'Manage datasets for your ForgeDB project.' });
    
    const projectId = routeParameter(this.route, 'projectId') ?? 0;
    if (projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }

    this.service.urlUpdateCallback = (datasetId, replaceUrl) => this.updateUrl(datasetId, replaceUrl);

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const value = params.get('datasetId');
      const parsed = value !== null ? Number(value) : null;
      const queryId = parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      this.service.handleQueryUpdate(queryId);
    });

    const initQueryId = this.parseDatasetId(this.route.snapshot.queryParamMap.get('datasetId'));
    this.service.init(projectId, initQueryId);
  }

  private parseDatasetId(value: string | null): number | null {
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private updateUrl(datasetId: number | null, replaceUrl: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { datasetId: datasetId === null ? null : String(datasetId) },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  openImport(source: ImportSource | null = null): void {
    this.service.clearSuccessMessage();
    this.importSource.set(source);
    this.importOpen.set(true);
  }

  onDatasetsImported(datasets: DatasetResponse[]): void {
    if (datasets.length) this.focusAfterImport = true;
    this.service.onDatasetsImported(datasets);
  }

  onImportDialogClosed(): void {
    this.importOpen.set(false);
    this.importSource.set(null);
    if (!this.focusAfterImport) return;
    this.focusAfterImport = false;
    setTimeout(() => this.pageHeading()?.nativeElement.focus());
  }

  onDatasetReplaced(updated: DatasetResponse): void {
    this.replaceOpen.set(false);
    this.service.onDatasetReplaced(updated);
    setTimeout(() => this.pageHeading()?.nativeElement.focus());
  }

  onDatasetDeleted(): void {
    this.confirmingDelete.set(false);
    this.service.onDatasetDeleted();
    setTimeout(() => this.pageHeading()?.nativeElement.focus());
  }

  onProjectSaved(updated: ProjectResponse): void {
    this.editOpen.set(false);
    this.service.onProjectSaved(updated);
  }

  continueToAnalyze(): void {
    if (!this.service.canContinueToAnalyze()) return;
    const datasetId = this.service.selectedDatasetId();
    void this.router.navigate(['/projects', this.service.projectId, 'analyze'], {
      queryParams: datasetId ? { datasetId } : {},
    });
  }
}
