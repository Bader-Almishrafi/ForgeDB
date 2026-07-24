import { DesignModelResponse, DesignTable } from '../../../services/api.models';

export interface ColumnDraft {
  name: string;
  sqlType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  defaultValue: string | null;
  isAutoIncrement: boolean;
}

export interface DraftErrors {
  tables: Record<number, string>;
  columns: Record<number, Record<string, string>>;
}

export const dataTypeOptions = [
  'SMALLINT', 'INTEGER', 'BIGINT', 'NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE PRECISION',
  'BOOLEAN', 'VARCHAR', 'TEXT', 'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'UUID',
] as const;
export const defaultVarcharLength = 255;
export const maxVarcharLength = 10_485_760;
const varcharPattern = /^VARCHAR\((\d+)\)$/i;
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export function buildDraftTables(
  design: DesignModelResponse | null,
  tableNames: Record<number, string>,
  columnDrafts: Record<number, ColumnDraft>,
): DesignTable[] {
  return (design?.tables ?? []).map((table) => ({
    ...table,
    name: tableNames[table.id] ?? table.name,
    columns: table.columns.map((column) => ({ ...column, ...(columnDrafts[column.id] ?? {}) })),
  }));
}

export function schemaDraftIsDirty(
  design: DesignModelResponse | null,
  tableNames: Record<number, string>,
  columnDrafts: Record<number, ColumnDraft>,
): boolean {
  if (!design) return false;
  return design.tables.some((table) => (tableNames[table.id] ?? table.name) !== table.name)
    || design.tables.some((table) => table.columns.some((column) => {
      const draft = columnDrafts[column.id];
      return Boolean(draft) && (draft.name !== column.name
        || draft.sqlType !== column.sqlType
        || draft.isNullable !== column.isNullable
        || draft.isPrimaryKey !== column.isPrimaryKey
        || draft.isUnique !== column.isUnique
        || (draft.defaultValue || null) !== (column.defaultValue || null)
        || draft.isAutoIncrement !== Boolean(column.isAutoIncrement));
    }));
}

export function validateSchemaDraft(tables: DesignTable[]): DraftErrors {
  const errors: DraftErrors = { tables: {}, columns: {} };
  for (const table of tables) {
    const tableNameError = validateName(table.name);
    if (tableNameError) errors.tables[table.id] = tableNameError;
    for (const column of table.columns) {
      const fields: Record<string, string> = {};
      const columnNameError = validateName(column.name);
      if (columnNameError) fields['name'] = columnNameError;
      if (!isSupportedType(column.sqlType)) fields['dataType'] = `Select a supported type or VARCHAR length from 1 to ${maxVarcharLength.toLocaleString()}.`;
      if (column.isPrimaryKey && column.isNullable) fields['nullable'] = 'Primary Keys are always NOT NULL.';
      if (column.isAutoIncrement && !identityCompatible(column.sqlType)) fields['autoIncrement'] = 'Identity requires an integer type.';
      if (column.isAutoIncrement && column.defaultValue?.trim()) fields['defaultValue'] = 'Identity columns cannot also define a default.';
      if ((column.defaultValue?.length ?? 0) > 512) fields['defaultValue'] = 'Defaults are limited to 512 characters.';
      if (Object.keys(fields).length) errors.columns[column.id] = fields;
    }
    for (const group of duplicateNames(table.columns.map((column) => ({ id: column.id, name: column.name })))) {
      for (const id of group.ids) errors.columns[id] = { ...(errors.columns[id] ?? {}), name: `Duplicate column name '${group.name}'.` };
    }
  }
  for (const group of duplicateNames(tables.map((table) => ({ id: table.id, name: table.name })))) {
    for (const id of group.ids) errors.tables[id] = `Duplicate table name '${group.name}'.`;
  }
  return errors;
}

export function identityCompatible(sqlType: string): boolean {
  return ['SMALLINT', 'INTEGER', 'BIGINT'].includes(sqlType.trim().toUpperCase());
}

export function isVarcharType(sqlType: string): boolean {
  return varcharPattern.test(sqlType.trim());
}

export function baseDataType(sqlType: string): string {
  return isVarcharType(sqlType) ? 'VARCHAR' : sqlType.trim().toUpperCase();
}

export function varcharLength(sqlType: string): number | null {
  const match = varcharPattern.exec(sqlType.trim());
  return match ? Number(match[1]) : null;
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Name is required.';
  if (trimmed.length > 63) return 'PostgreSQL identifiers are limited to 63 characters.';
  if (!identifierPattern.test(trimmed)) return 'Use letters, digits, and underscores; start with a letter or underscore.';
  return '';
}

function isSupportedType(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  if (normalized !== 'VARCHAR' && (dataTypeOptions as readonly string[]).includes(normalized)) return true;
  const varchar = varcharPattern.exec(value.trim());
  return Boolean(varchar && Number(varchar[1]) >= 1 && Number(varchar[1]) <= maxVarcharLength);
}

function duplicateNames(items: Array<{ id: number; name: string }>): Array<{ name: string; ids: number[] }> {
  const groups = new Map<string, { name: string; ids: number[] }>();
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    const group = groups.get(key) ?? { name: item.name.trim(), ids: [] };
    group.ids.push(item.id);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.ids.length > 1);
}
