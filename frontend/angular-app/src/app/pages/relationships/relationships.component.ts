import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-relationships',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './relationships.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelationshipsComponent {
  readonly tables = [
    { name: 'customers', relationships: 1 },
    { name: 'orders', relationships: 3 },
    { name: 'order_items', relationships: 2 },
    { name: 'products', relationships: 2 },
    { name: 'categories', relationships: 1 },
    { name: 'payments', relationships: 1 },
  ];
}
