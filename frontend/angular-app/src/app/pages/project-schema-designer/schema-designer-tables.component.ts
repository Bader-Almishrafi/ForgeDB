import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideTable2, LucideTriangleAlert } from '@lucide/angular';
import { dataTypeOptions, maxVarcharLength } from '../../services/schema-draft';
import { ProjectSchemaDesignerService } from '../../services/project-schema-designer.service';

@Component({
  selector: 'app-schema-designer-tables',
  standalone: true,
  imports: [FormsModule, LucideTable2, LucideTriangleAlert],
  templateUrl: './schema-designer-tables.component.html',
  styleUrls: ['./project-schema-designer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchemaDesignerTablesComponent {
  readonly service = inject(ProjectSchemaDesignerService);
  readonly dataTypeOptions = dataTypeOptions;
  readonly maxVarcharLength = maxVarcharLength;
}
