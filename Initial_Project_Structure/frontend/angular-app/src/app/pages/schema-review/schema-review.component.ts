import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

interface SchemaColumn {
  name: string;
  type: string;
  constraints: string[];
  nullable: boolean;
}

interface DbConstraint {
  name: string;
  type: string;
  table: string;
  columns: string;
  definition: string;
}

@Component({
  selector: 'app-schema-review',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './schema-review.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchemaReviewComponent {
  readonly activeTab = signal<'tables' | 'sql' | 'constraints'>('tables');
  selectedTable = 'customers';

  readonly tables = [
    { name: 'customers', rows: '12,540' },
    { name: 'orders', rows: '45,231' },
    { name: 'order_items', rows: '120,987' },
    { name: 'products', rows: '8,765' },
    { name: 'categories', rows: '256' },
    { name: 'payments', rows: '33,112' },
  ];

  readonly columns: SchemaColumn[] = [
    { name: 'id', type: 'BIGINT', constraints: ['PK', 'NOT NULL'], nullable: false },
    { name: 'name', type: 'VARCHAR(255)', constraints: ['NOT NULL'], nullable: false },
    { name: 'email', type: 'VARCHAR(255)', constraints: ['UNIQUE', 'NOT NULL'], nullable: false },
    { name: 'phone', type: 'VARCHAR(20)', constraints: ['NULL'], nullable: true },
    { name: 'address', type: 'TEXT', constraints: ['NULL'], nullable: true },
    { name: 'created_at', type: 'TIMESTAMP', constraints: ['NOT NULL', 'DEFAULT: now()'], nullable: false },
    { name: 'updated_at', type: 'TIMESTAMP', constraints: ['DEFAULT: now()'], nullable: true },
  ];

  readonly constraints: DbConstraint[] = [
    { name: 'customers_pkey', type: 'Primary Key', table: 'customers', columns: 'id', definition: 'PRIMARY KEY (id)' },
    { name: 'customers_email_key', type: 'Unique', table: 'customers', columns: 'email', definition: 'UNIQUE (email)' },
    { name: 'orders_pkey', type: 'Primary Key', table: 'orders', columns: 'id', definition: 'PRIMARY KEY (id)' },
    { name: 'orders_customer_id_fkey', type: 'Foreign Key', table: 'orders', columns: 'customer_id', definition: 'REFERENCES customers(id) ON DELETE CASCADE' },
    { name: 'orders_status_check', type: 'Check', table: 'orders', columns: 'status', definition: "CHECK (status IN ('PENDING', 'PROCESSING', 'SHIPPED', 'CANCELLED'))" },
    { name: 'order_items_pkey', type: 'Primary Key', table: 'order_items', columns: 'id', definition: 'PRIMARY KEY (id)' },
    { name: 'order_items_order_id_fkey', type: 'Foreign Key', table: 'order_items', columns: 'order_id', definition: 'REFERENCES orders(id) ON DELETE CASCADE' },
    { name: 'order_items_product_id_fkey', type: 'Foreign Key', table: 'order_items', columns: 'product_id', definition: 'REFERENCES products(id) ON DELETE RESTRICT' },
  ];

  readonly sql = `-- Table: customers
CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Table: orders
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_date TIMESTAMP NOT NULL DEFAULT now(),
  status VARCHAR(50) NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL
);

-- Table: order_items
CREATE TABLE order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL
);

-- Table: products
CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  category_id BIGINT REFERENCES categories(id),
  name VARCHAR(150) NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0
);`;

  setTab(tab: 'tables' | 'sql' | 'constraints'): void {
    this.activeTab.set(tab);
  }
}
