import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideCheckCircle2,
  LucideDatabase,
  LucideFileCheck2,
  LucideRefreshCw,
  LucideSave,
  LucideTable2,
  LucideTriangleAlert,
} from '@lucide/angular';
import { Observable, Subject, take } from 'rxjs';
import { ValidationIssue } from '../../services/api.models';
import { routeParameter } from '../../services/route-context';
import { UnsavedChangesAware } from '../../services/unsaved-changes.guard';
import { SchemaDesignerTablesComponent } from './schema-designer-tables.component';
import { SchemaDesignerSqlPreviewComponent } from './schema-designer-sql-preview.component';
import { SchemaRelationshipsComponent } from './schema-relationships.component';
import { ProjectSchemaDesignerService } from './services/project-schema-designer.service';

type SchemaTab = 'tables' | 'relationships' | 'validation' | 'sql';

@Component({
  selector: 'app-project-schema-designer',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    NgClass,
    RouterLink,
    SchemaDesignerTablesComponent,
    SchemaDesignerSqlPreviewComponent,
    SchemaRelationshipsComponent,
    LucideArrowLeft,
    LucideCheckCircle2,
    LucideDatabase,
    LucideFileCheck2,
    LucideRefreshCw,
    LucideSave,
    LucideTable2,
    LucideTriangleAlert,
  ],
  providers: [ProjectSchemaDesignerService],
  templateUrl: './project-schema-designer.component.html',
  styleUrl: './project-schema-designer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectSchemaDesignerComponent implements OnInit, UnsavedChangesAware {
  readonly service = inject(ProjectSchemaDesignerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private allowNavigation = false;
  private leaveDecision: Subject<boolean> | null = null;
  private leaveTrigger: HTMLElement | null = null;
  private querySanitized = false;

  readonly stayButton = viewChild<ElementRef<HTMLButtonElement>>('stayButton');
  readonly leaveButton = viewChild<ElementRef<HTMLButtonElement>>('leaveButton');
  readonly regenerateDialog = viewChild<ElementRef<HTMLDialogElement>>('regenerateDialog');
  readonly regenerateCancelButton = viewChild<ElementRef<HTMLButtonElement>>('regenerateCancelButton');
  readonly schemaHeading = viewChild<ElementRef<HTMLHeadingElement>>('schemaHeading');
  readonly leaveDialogOpen = signal(false);
  readonly activeTab = signal<SchemaTab>('tables');
  private regenerateTrigger: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.service.tableCount() === 0 && this.activeTab() === 'relationships') {
        this.activeTab.set('tables');
      }
    }, { allowSignalWrites: true });
    effect(() => {
      if (this.service.loading() || this.querySanitized) return;
      this.querySanitized = true;
      const rawDatasetId = this.route.snapshot.queryParamMap.get('datasetId');
      if (rawDatasetId === null) return;
      const requestedDatasetId = Number(rawDatasetId);
      const isValidSelection = Number.isInteger(requestedDatasetId)
        && requestedDatasetId > 0
        && this.service.datasetId() === requestedDatasetId;
      if (!isValidSelection) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { datasetId: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
  }

  ngOnInit(): void {
    const projectId = routeParameter(this.route, 'projectId') ?? 0;
    if (projectId <= 0) {
      void this.router.navigate(['/projects']);
      return;
    }
    const requested = Number(this.route.snapshot.queryParamMap.get('datasetId'));
    const datasetId = Number.isInteger(requested) && requested > 0 ? requested : null;
    this.service.init(projectId, datasetId);
  }

  continueToExport(): void {
    if (!this.service.canContinue()) return;
    this.allowNavigation = true;
    const datasetId = this.service.datasetId();
    void this.router.navigate(
      ['/projects', this.service.projectId, 'export-deploy'],
      datasetId ? { queryParams: { datasetId } } : undefined,
    );
  }

  canDeactivate(): Observable<boolean> | boolean {
    if (this.allowNavigation || !this.service.dirty()) return true;
    this.leaveTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.leaveDecision = new Subject<boolean>();
    this.leaveDialogOpen.set(true);
    setTimeout(() => this.stayButton()?.nativeElement.focus(), 50);
    return this.leaveDecision.asObservable().pipe(take(1));
  }

  resolveLeaveDialog(leave: boolean): void {
    const decision = this.leaveDecision;
    if (!decision) return;
    if (leave) this.allowNavigation = true;
    this.leaveDialogOpen.set(false);
    this.leaveDecision = null;
    decision.next(leave);
    decision.complete();
    const trigger = this.leaveTrigger;
    this.leaveTrigger = null;
    if (!leave) setTimeout(() => trigger?.focus(), 0);
  }

  @HostListener('window:beforeunload', ['$event'])
  protectBrowserUnload(event: BeforeUnloadEvent): void {
    if (!this.allowNavigation && this.service.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.leaveDialogOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.resolveLeaveDialog(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const first = this.stayButton()?.nativeElement;
    const last = this.leaveButton()?.nativeElement;
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !first.closest('[role="alertdialog"]')?.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  requestRegenerate(event?: Event): void {
    if (!this.service.canGenerate()) return;
    if (this.service.design()) {
      this.regenerateTrigger = event?.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const dialog = this.regenerateDialog()?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
      setTimeout(() => this.regenerateCancelButton()?.nativeElement.focus(), 0);
    } else {
      this.service.generateSchema();
    }
  }

  confirmRegenerate(): void {
    this.closeRegenerateDialog(false);
    this.service.generateSchema(true);
    setTimeout(() => this.schemaHeading()?.nativeElement.focus(), 0);
  }

  closeRegenerateDialog(restoreFocus = true): void {
    const dialog = this.regenerateDialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    const trigger = this.regenerateTrigger;
    this.regenerateTrigger = null;
    if (restoreFocus) setTimeout(() => trigger?.focus(), 0);
  }

  onRegenerateCancel(event: Event): void {
    event.preventDefault();
    this.closeRegenerateDialog();
  }

  reviewIssue(issue: ValidationIssue): void {
    if (issue.relationshipId) {
      this.activeTab.set('relationships');
      return;
    }
    if (issue.tableId) this.service.selectTable(issue.tableId);
    this.activeTab.set('tables');
  }

  onTabKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    if (this.service.relationshipMutationBusy()) {
      event.preventDefault();
      return;
    }
    const tabs: SchemaTab[] = this.service.tableCount() > 0
      ? ['tables', 'relationships', 'validation', 'sql']
      : ['tables', 'validation', 'sql'];
    const currentIndex = Math.max(0, tabs.indexOf(this.activeTab()));
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    const nextTab = tabs[nextIndex];
    event.preventDefault();
    this.activeTab.set(nextTab);
    setTimeout(() => document.getElementById(`schema-tab-${nextTab}`)?.focus(), 0);
  }
}
