import { ChangeDetectionStrategy, Component, computed, output, signal } from '@angular/core';
import { DesignStateService } from '../../../services/design-state.service';

type PreviewTab = 'sql' | 'dbml';

/**
 * Right-hand read-only SQL/DBML preview for the Schema Designer page. Purely reactive: it never
 * triggers a preview fetch itself, it only renders `DesignStateService.previewSql()` /
 * `previewDbml()`, which the service already (debounced) refreshes after every successful
 * mutation.
 */
@Component({
  selector: 'app-preview-panel',
  standalone: true,
  imports: [],
  templateUrl: './preview-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreviewPanelComponent {
  readonly openIssues = output<void>();

  readonly activeTab = signal<PreviewTab>('sql');
  readonly copied = signal(false);

  readonly activePreviewText = computed(() =>
    this.activeTab() === 'sql' ? this.designState.previewSql() : this.designState.previewDbml(),
  );

  constructor(readonly designState: DesignStateService) {}

  copyPreview(): void {
    navigator.clipboard
      .writeText(this.activePreviewText())
      .then(() => {
        this.copied.set(true);
        window.setTimeout(() => this.copied.set(false), 2000);
      })
      .catch(() => {
        // Clipboard permissions can silently reject in some browsers/contexts; this panel is
        // read-only and has no local error banner, so there is nothing else to surface here.
      });
  }
}
