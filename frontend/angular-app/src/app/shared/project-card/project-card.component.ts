import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ProjectResponse } from '../../services/api.models';

@Component({
  selector: 'app-project-card',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './project-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCardComponent {
  readonly project = input.required<ProjectResponse>();
  readonly openProject = output<ProjectResponse>();
  readonly relevantDate = computed(() => this.project().updatedAt || this.project().createdAt);
  readonly dateLabel = computed(() => this.project().updatedAt ? 'Last modified' : 'Created');
}
