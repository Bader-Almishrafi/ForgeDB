import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { LucideCheckCircle2, LucideClipboard } from '@lucide/angular';
import { ValidationIssue } from '../../services/api.models';
import { ProjectSchemaDesignerService } from '../../services/project-schema-designer.service';

@Component({
  selector: 'app-schema-designer-validation',
  standalone: true,
  imports: [DatePipe, LucideCheckCircle2, LucideClipboard],
  templateUrl: './schema-designer-validation.component.html',
  styleUrls: ['./project-schema-designer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchemaDesignerValidationComponent {
  readonly service = inject(ProjectSchemaDesignerService);
  @Output() focusTable = new EventEmitter<ValidationIssue>();
  
  readonly copied = signal(false);

  copySql(): void {
    if (!this.service.sqlPreview()) return;
    navigator.clipboard.writeText(this.service.sqlPreview()).then(() => {
      this.copied.set(true);
      window.setTimeout(() => this.copied.set(false), 1800);
    }).catch(() => this.service.feedback.set({ kind: 'error', title: 'Copy failed', message: 'Clipboard permission was denied.' }));
  }

  focusIssue(issue: ValidationIssue): void {
    this.focusTable.emit(issue);
  }
}
