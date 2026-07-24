import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LucideClipboard } from '@lucide/angular';
import { ProjectSchemaDesignerService } from './services/project-schema-designer.service';

@Component({
  selector: 'app-schema-designer-sql-preview',
  standalone: true,
  imports: [LucideClipboard],
  templateUrl: './schema-designer-sql-preview.component.html',
  styleUrls: ['./project-schema-designer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchemaDesignerSqlPreviewComponent {
  readonly service = inject(ProjectSchemaDesignerService);
  
  readonly copied = signal(false);

  copySql(): void {
    if (!this.service.sqlPreview()) return;
    navigator.clipboard.writeText(this.service.sqlPreview()).then(() => {
      this.copied.set(true);
      window.setTimeout(() => this.copied.set(false), 1800);
    }).catch(() => this.service.feedback.set({ kind: 'error', title: 'Copy failed', message: 'Clipboard permission was denied.' }));
  }
}
