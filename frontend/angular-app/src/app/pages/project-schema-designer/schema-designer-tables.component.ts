import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideTable2, LucideTriangleAlert, LucideChevronLeft, LucideChevronRight } from '@lucide/angular';
import { dataTypeOptions, maxVarcharLength } from '../../services/schema-draft';
import { ProjectSchemaDesignerService } from '../../services/project-schema-designer.service';

@Component({
  selector: 'app-schema-designer-tables',
  standalone: true,
  imports: [FormsModule, LucideTable2, LucideTriangleAlert, LucideChevronLeft, LucideChevronRight],
  templateUrl: './schema-designer-tables.component.html',
  styleUrls: ['./project-schema-designer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchemaDesignerTablesComponent {
  readonly service = inject(ProjectSchemaDesignerService);
  readonly dataTypeOptions = dataTypeOptions;
  readonly maxVarcharLength = maxVarcharLength;

  readonly pageIndex = signal(0);
  readonly pageSize = signal(10);

  readonly paginatedColumns = computed(() => {
    const table = this.service.selectedTable();
    if (!table) return [];
    const start = this.pageIndex() * this.pageSize();
    return table.columns.slice(start, start + this.pageSize());
  });

  readonly totalPages = computed(() => {
    const table = this.service.selectedTable();
    if (!table || table.columns.length === 0) return 1;
    return Math.ceil(table.columns.length / this.pageSize());
  });

  constructor() {
    effect(() => {
      // Reset page when table changes
      this.service.selectedTableId();
      this.pageIndex.set(0);
    }, { allowSignalWrites: true });
  }
}
