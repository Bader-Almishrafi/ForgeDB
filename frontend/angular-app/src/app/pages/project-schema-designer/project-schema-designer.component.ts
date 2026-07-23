import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideCheckCircle2,
  LucideClipboard,
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
import { SchemaDesignerValidationComponent } from './schema-designer-validation.component';
import { SchemaRelationshipsComponent } from './schema-relationships.component';
import { ProjectSchemaDesignerService } from '../../services/project-schema-designer.service';

@Component({
  selector: 'app-project-schema-designer',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    NgClass,
    RouterLink,
    SchemaDesignerTablesComponent,
    SchemaDesignerValidationComponent,
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

  readonly stayButton = viewChild<ElementRef<HTMLButtonElement>>('stayButton');
  readonly leaveDialogOpen = signal(false);
  readonly activeTab = signal<'tables' | 'relationships' | 'validation'>('tables');

  constructor() {
    effect(() => {
      if (this.service.tableCount() <= 1 && this.activeTab() === 'relationships') {
        this.activeTab.set('tables');
      }
    }, { allowSignalWrites: true });
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

  focusIssue(issue: ValidationIssue): void {
    if (issue.tableId) {
      this.service.selectedTableId.set(issue.tableId);
      this.activeTab.set('tables');
    }
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

  canDeactivate(): boolean | Observable<boolean> {
    if (this.allowNavigation || !this.service.dirty()) return true;
    if (this.leaveDecision) return this.leaveDecision.asObservable().pipe(take(1));
    this.leaveDecision = new Subject<boolean>();
    this.leaveDialogOpen.set(true);
    queueMicrotask(() => this.stayButton()?.nativeElement.focus());
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
  }

  @HostListener('window:beforeunload', ['$event'])
  protectBrowserUnload(event: BeforeUnloadEvent): void {
    if (!this.allowNavigation && this.service.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.leaveDialogOpen()) this.resolveLeaveDialog(false);
  }
}
