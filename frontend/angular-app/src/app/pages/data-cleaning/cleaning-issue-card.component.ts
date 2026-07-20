import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CleaningStrategy, CleaningSuggestion } from '../../services/api.models';

@Component({
  selector: 'app-cleaning-issue-card',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  templateUrl: './cleaning-issue-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CleaningIssueCardComponent {
  @Input({ required: true }) suggestion!: CleaningSuggestion;
  @Input({ required: true }) strategy!: CleaningStrategy;
  @Input() selected = false;
  @Input() customValue = '';
  @Input() duplicateColumns = '';
  @Input() busy = false;

  @Output() selectionChange = new EventEmitter<void>();
  @Output() strategyChange = new EventEmitter<string>();
  @Output() customValueChange = new EventEmitter<string>();
  @Output() duplicateColumnsChange = new EventEmitter<string>();
  @Output() previewRequested = new EventEmitter<void>();

  get needsCustomValue(): boolean {
    return this.strategy.parameters['strategy'] === 'custom' || this.strategy.parameters['invalidAction'] === 'replace';
  }

  get needsDuplicateColumns(): boolean {
    return this.strategy.operationType === 'remove_duplicates';
  }
}
