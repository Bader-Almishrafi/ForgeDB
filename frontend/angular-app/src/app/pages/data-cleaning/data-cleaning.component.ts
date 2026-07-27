import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, OnInit, signal, viewChild, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CleaningSuggestion, DatasetVersion } from '../../services/api.models';
import { ProjectWorkflowContextService } from '../../services/project-workflow-context.service';
import { routeParameter } from '../../services/route-context';
import { CleaningIssueCardComponent } from './cleaning-issue-card.component';
import { CleaningPreviewDialogComponent } from './cleaning-preview-dialog.component';
import { DataCleaningApiService } from './services/data-cleaning-api.service';
import { DataCleaningStateService } from './services/data-cleaning-state.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-data-cleaning',
  standalone: true,
  imports: [CleaningIssueCardComponent, CleaningPreviewDialogComponent, DatePipe, DecimalPipe, FormsModule, RouterLink],
  templateUrl: './data-cleaning.component.html',
  styleUrl: './data-cleaning.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DataCleaningApiService, DataCleaningStateService],
})
export class DataCleaningComponent implements OnInit {
  readonly apiService = inject(DataCleaningApiService);
  readonly stateService = inject(DataCleaningStateService);
  readonly workflowContext = inject(ProjectWorkflowContextService);
  private readonly toastService = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly queryDatasetValue = signal<string | null | undefined>(undefined);

  private readonly applyRouteScopeWhenReady = effect(() => {
    const queryDatasetValue = this.queryDatasetValue();
    if (queryDatasetValue === undefined || !this.apiService.summary()) return;
    this.applyRouteScope(queryDatasetValue);
  });

  readonly previewDialog = viewChild(CleaningPreviewDialogComponent);
  readonly confirmDialog = viewChild<ElementRef<HTMLDialogElement>>('confirmDialog');
  readonly confirmCancelButton = viewChild<ElementRef<HTMLButtonElement>>('confirmCancelButton');
  private returnFocusElement: HTMLElement | null = null;

  readonly bulkStrategyOptions = computed(() => {
    const selected = this.stateService.selectedSuggestions();
    if (!selected.length) return [];
    
    const strategyMap = new Map<string, { key: string; label: string }>();
    selected.forEach(suggestion => {
      suggestion.availableStrategies.forEach(strategy => {
        if (!strategyMap.has(strategy.key)) {
          strategyMap.set(strategy.key, { key: strategy.key, label: strategy.label });
        }
      });
    });
    return Array.from(strategyMap.values());
  });

  projectId = 0;

  ngOnInit(): void {
    this.projectId = routeParameter(this.route, 'projectId') ?? 0;
    if (this.projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.queryDatasetValue.set(params.get('datasetId'));
      if (params.has('issueType') || params.has('column') || params.has('search')) this.removeLegacyFilterParams();
    });
    this.apiService.loadWorkspace(this.projectId);
  }

  openDataset(datasetId: number): void {
    this.changeScope(datasetId);
  }

  changeScope(value: 'project' | number): void {
    const nextScope = value === 'project' ? 'project' : Number(value);
    if (nextScope !== 'project' && (!Number.isInteger(nextScope) || !this.apiService.datasets().some((dataset) => dataset.datasetId === nextScope))) {
      return;
    }

    this.apiService.invalidatePreview();
    this.apiService.clearVersions();
    this.stateService.changeScope(nextScope);
    this.updateDatasetQuery(nextScope === 'project' ? null : nextScope, false);
    if (nextScope !== 'project') void this.apiService.loadVersions(nextScope);
  }

  async previewSuggestion(suggestion: CleaningSuggestion): Promise<void> {
    await this.apiService.previewOperationsRequest([this.stateService.buildOperation(suggestion)]);
    if (!this.apiService.preview()) this.stateService.resetIssueSelection();
  }

  async previewSelected(): Promise<void> {
    const selected = this.stateService.selectedSuggestions();
    if (!selected.length) return;
    await this.apiService.previewOperationsRequest(this.stateService.buildOperations(selected));
    if (!this.apiService.preview()) this.stateService.resetIssueSelection();
  }

  applyBulkStrategy(strategyKey: string): void {
    if (!strategyKey) return;
    const selected = this.stateService.selectedSuggestions();
    selected.forEach(suggestion => {
      const strategy = suggestion.availableStrategies.find(s => s.key === strategyKey);
      if (strategy) {
        this.stateService.updateStrategy(suggestion, strategy.key);
      }
    });
  }

  async previewRecommendedFixes(): Promise<void> {
    const safe = this.stateService.safeRecommendations();
    if (!safe.length) {
      this.toastService.showWarning('No safe recommendations found. The current issues require individual review or destructive-operation confirmation.');
      return;
    }
    this.stateService.selectedIds.set(new Set(safe.map((s) => s.id)));
    await this.apiService.previewOperationsRequest(this.stateService.buildOperations(safe));
    if (!this.apiService.preview()) this.stateService.resetIssueSelection();
  }

  closePreview(force = false): void {
    if (this.apiService.applyLoading() && !force) return;
    this.previewDialog()?.close();
    this.apiService.invalidatePreview();
  }

  async applyPreview(): Promise<void> {
    await this.apiService.applyPreview(() => {
      this.closePreview(true);
      this.stateService.resetIssueSelection();
    });
  }

  async removePreviewOperation(operationId: string | null | undefined): Promise<void> {
    if (!operationId || this.apiService.previewLoading() || this.apiService.applyLoading()) return;
    const remaining = this.apiService.previewOperations().filter((op) => op.operationId !== operationId);
    if (!remaining.length) {
      this.closePreview();
      return;
    }
    await this.apiService.previewOperationsRequest(remaining);
    if (!this.apiService.preview()) this.stateService.resetIssueSelection();
  }

  requestUndo(): void {
    if (!this.apiService.latestUndoable()) return;
    this.apiService.confirmAction.set({ kind: 'undo' });
    this.openConfirmDialog();
  }

  requestRestore(datasetId: number, version: DatasetVersion): void {
    if (version.isActive) return;
    this.apiService.confirmAction.set({ kind: 'restore', datasetId, version });
    this.openConfirmDialog();
  }

  closeConfirmDialog(): void {
    if (this.apiService.applyLoading()) return;
    this.dismissConfirmDialog();
  }

  async confirmUndoOrRestore(): Promise<void> {
    await this.apiService.confirmUndoOrRestore(() => {
      this.dismissConfirmDialog();
      this.stateService.resetIssueSelection();
    });
  }

  async retryAnalysis(): Promise<void> {
    await this.apiService.retryAnalysis();
  }

  async confirmQuality(): Promise<void> {
    await this.apiService.confirmQuality();
  }

  continueToSchema(): void {
    if (!this.apiService.canContinueToSchema()) return;
    const datasetId = this.stateService.selectedDataset()?.datasetId;
    void this.router.navigate(['/projects', this.projectId, 'schema'], { queryParams: datasetId ? { datasetId } : {} });
  }

  navigationQuery(): { datasetId: number } | Record<string, never> {
    const datasetId = this.stateService.selectedDataset()?.datasetId;
    return datasetId ? { datasetId } : {};
  }

  private dismissConfirmDialog(): void {
    this.apiService.confirmAction.set(null);
    const dialog = this.confirmDialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    const returnFocusElement = this.returnFocusElement;
    this.returnFocusElement = null;
    setTimeout(() => returnFocusElement?.focus());
  }

  private openConfirmDialog(): void {
    this.returnFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = this.confirmDialog()?.nativeElement;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setTimeout(() => this.confirmCancelButton()?.nativeElement.focus());
  }

  private applyRouteScope(queryDatasetValue: string | null): void {
    if (queryDatasetValue === null) {
      if (this.stateService.scope() !== 'project') this.stateService.changeScope('project');
      else this.workflowContext.setDatasetFromQuery(null);
      this.apiService.clearVersions();
      return;
    }
    const datasetId = Number(queryDatasetValue);
    if (Number.isInteger(datasetId) && datasetId > 0 && this.apiService.datasets().some((d) => d.datasetId === datasetId)) {
      this.stateService.changeScope(datasetId);
      void this.apiService.loadVersions(datasetId);
      return;
    }
    this.stateService.changeScope('project');
    this.apiService.clearVersions();
    this.stateService.scopeNotice.set('The selected dataset is not in this project. Showing all datasets.');
    this.updateDatasetQuery(null, true);
  }

  private updateDatasetQuery(datasetId: number | null, replaceUrl: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      replaceUrl,
      queryParams: { datasetId, issueType: null, column: null, search: null },
    });
  }

  private removeLegacyFilterParams(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      replaceUrl: true,
      queryParams: { issueType: null, column: null, search: null },
    });
  }
}
