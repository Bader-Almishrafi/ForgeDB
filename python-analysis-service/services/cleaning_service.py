from __future__ import annotations

import copy
import math
import re
import statistics
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

from models.cleaning import (
    CleaningColumn,
    CleaningOperation,
    CleaningOperationResult,
    CleaningPreviewRow,
    CleaningRequest,
    CleaningResponse,
    ConversionFailure,
)


class CleaningValidationError(ValueError):
    pass


class CleaningService:
    _operation_priority = {
        "rename_column": 10,
        "text_normalize": 20,
        "normalize_numeric": 30,
        "convert_type": 40,
        "parse_date": 41,
        "fill_missing": 50,
        "handle_outliers": 60,
        "remove_duplicates": 70,
        "delete_rows": 80,
        "delete_rows_condition": 81,
        "delete_column": 90,
    }
    _supported_operations = frozenset(_operation_priority)
    _known_currency_symbols = ("$", "€", "£", "¥", "₹", "SAR", "USD", "EUR", "GBP")
    _date_formats = {
        "iso": None,
        "yyyy-mm-dd": "%Y-%m-%d",
        "dd/mm/yyyy": "%d/%m/%Y",
        "mm/dd/yyyy": "%m/%d/%Y",
        "yyyy-mm-dd hh:mm:ss": "%Y-%m-%d %H:%M:%S",
        "dd-mm-yyyy": "%d-%m-%Y",
        "mm-dd-yyyy": "%m-%d-%Y",
    }

    def execute(self, request: CleaningRequest) -> CleaningResponse:
        ordered = sorted(
            enumerate(request.operations),
            key=lambda item: (self._operation_priority.get(item[1].operationType, 999), item[0]),
        )
        for _, operation in ordered:
            if operation.operationType not in self._supported_operations:
                raise CleaningValidationError(f"Unsupported cleaning operation '{operation.operationType}'.")

        original_rows = [self._tag_row(row, index + 1) for index, row in enumerate(copy.deepcopy(request.rows))]
        rows = copy.deepcopy(original_rows)
        columns = [column.model_copy(deep=True) for column in request.columns]
        failures: list[ConversionFailure] = []
        warnings: list[str] = []
        operation_results: list[CleaningOperationResult] = []

        for requested_index, operation in ordered:
            operation_id = operation.operationId or f"operation-{requested_index + 1}"
            result = CleaningOperationResult(
                operationId=operation_id,
                operationType=operation.operationType,
                column=operation.column,
            )
            rows, columns = self._apply_operation(rows, columns, operation, result, failures)
            warnings.extend(result.warnings)
            operation_results.append(result)

        before_by_number = {row["__rowNumber"]: self._strip_tag(row) for row in original_rows}
        after_by_number = {row["__rowNumber"]: self._strip_tag(row) for row in rows}
        changed_numbers = sorted(
            number
            for number in set(before_by_number) | set(after_by_number)
            if before_by_number.get(number) != after_by_number.get(number)
        )
        preview_rows = [
            CleaningPreviewRow(
                rowNumber=number,
                before=before_by_number.get(number),
                after=after_by_number.get(number),
            )
            for number in changed_numbers[:10]
        ]
        affected_cells = sum(result.affectedCells for result in operation_results)

        return CleaningResponse(
            datasetId=request.datasetId,
            sourceVersionId=request.versionId,
            executionOrder=[result.operationId for result in operation_results],
            columns=columns,
            resultRows=[self._strip_tag(row) for row in rows],
            previewRows=preview_rows,
            operationResults=operation_results,
            affectedRows=len(changed_numbers),
            affectedCells=affected_cells,
            rowsRemoved=max(len(original_rows) - len(rows), 0),
            columnsRemoved=sum(result.columnsRemoved for result in operation_results),
            columnsRenamed=sum(result.columnsRenamed for result in operation_results),
            conversionFailures=failures,
            warnings=list(dict.fromkeys(warnings)),
            destructive=any(result.destructive for result in operation_results),
        )

    def _apply_operation(
        self,
        rows: list[dict[str, Any]],
        columns: list[CleaningColumn],
        operation: CleaningOperation,
        result: CleaningOperationResult,
        failures: list[ConversionFailure],
    ) -> tuple[list[dict[str, Any]], list[CleaningColumn]]:
        handlers: dict[str, Callable[..., tuple[list[dict[str, Any]], list[CleaningColumn]]]] = {
            "rename_column": self._rename_column,
            "text_normalize": self._text_normalize,
            "normalize_numeric": self._normalize_numeric,
            "convert_type": self._convert_type,
            "parse_date": self._parse_date,
            "fill_missing": self._fill_missing,
            "handle_outliers": self._handle_outliers,
            "remove_duplicates": self._remove_duplicates,
            "delete_rows": self._delete_rows,
            "delete_rows_condition": self._delete_rows_condition,
            "delete_column": self._delete_column,
        }
        return handlers[operation.operationType](rows, columns, operation, result, failures)

    def _rename_column(self, rows, columns, operation, result, failures):
        old = self._require_column(operation, columns)
        new = str(operation.parameters.get("newName", "")).strip()
        if not new or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_ ]{0,127}", new):
            raise CleaningValidationError("New column name is invalid.")
        if any(column.name.lower() == new.lower() and column.name.lower() != old.lower() for column in columns):
            raise CleaningValidationError(f"Column '{new}' already exists.")
        for row in rows:
            if old in row:
                row[new] = row.pop(old)
                result.affectedRows += 1
                result.affectedCells += 1
        for column in columns:
            if column.name == old:
                column.name = new
        result.columnsRenamed = 1
        return rows, columns

    def _text_normalize(self, rows, columns, operation, result, failures):
        column = self._require_column(operation, columns)
        action = str(operation.parameters.get("action", "trim")).lower()
        allowed = {"trim", "collapse_spaces", "lowercase", "uppercase", "title_case", "replace_exact", "find_replace"}
        if action not in allowed:
            raise CleaningValidationError(f"Unsupported text normalization action '{action}'.")
        find = str(operation.parameters.get("find", ""))
        replacement = str(operation.parameters.get("replacement", ""))
        if action == "find_replace" and not find:
            raise CleaningValidationError("Find text is required.")
        for row in rows:
            value = row.get(column)
            if not isinstance(value, str):
                continue
            normalized = value
            if action == "trim": normalized = value.strip()
            elif action == "collapse_spaces": normalized = re.sub(r"\s+", " ", value)
            elif action == "lowercase": normalized = value.lower()
            elif action == "uppercase": normalized = value.upper()
            elif action == "title_case": normalized = value.title()
            elif action == "replace_exact" and value == find: normalized = replacement
            elif action == "find_replace": normalized = value.replace(find, replacement)
            if normalized != value:
                row[column] = normalized
                result.affectedRows += 1
                result.affectedCells += 1
        return rows, columns

    def _normalize_numeric(self, rows, columns, operation, result, failures):
        column = self._require_column(operation, columns)
        remove_thousands = bool(operation.parameters.get("removeThousands", False))
        decimal_separator = operation.parameters.get("decimalSeparator")
        if decimal_separator not in {None, ".", ","}:
            raise CleaningValidationError("Decimal separator must be '.' or ','.")
        requested_symbols = operation.parameters.get("currencySymbols", [])
        if not isinstance(requested_symbols, list) or any(symbol not in self._known_currency_symbols for symbol in requested_symbols):
            raise CleaningValidationError("Only known currency symbols may be removed.")
        percentage = bool(operation.parameters.get("percentage", False))
        target_type = str(operation.parameters.get("targetType", "decimal")).lower()
        if target_type not in {"integer", "decimal"}:
            raise CleaningValidationError("Normalized numeric target type must be integer or decimal.")
        for row in rows:
            value = row.get(column)
            if self._is_missing(value):
                continue
            text = str(value).strip()
            for symbol in requested_symbols:
                text = text.replace(symbol, "")
            has_percent = text.endswith("%")
            if has_percent:
                text = text[:-1]
            if decimal_separator == ",":
                if remove_thousands: text = text.replace(".", "")
                text = text.replace(",", ".")
            elif remove_thousands:
                text = text.replace(",", "")
            try:
                number = Decimal(text.strip())
                if percentage or has_percent: number /= Decimal(100)
                converted: Any = int(number) if target_type == "integer" and number == number.to_integral_value() else float(number)
                if target_type == "integer" and number != number.to_integral_value():
                    raise ValueError("Value is not a whole number.")
            except (InvalidOperation, ValueError):
                failures.append(self._failure(row, column, value, "Numeric normalization failed."))
                continue
            if converted != value:
                row[column] = converted
                result.affectedRows += 1
                result.affectedCells += 1
        self._set_column_type(columns, column, target_type)
        return rows, columns

    def _convert_type(self, rows, columns, operation, result, failures):
        column = self._require_column(operation, columns)
        target = str(operation.parameters.get("targetType", "")).lower()
        if target not in {"integer", "decimal", "string", "boolean", "datetime"}:
            raise CleaningValidationError("Target type must be integer, decimal, string, boolean, or datetime.")
        invalid_action = str(operation.parameters.get("invalidAction", "leave")).lower()
        if invalid_action not in {"leave", "null"}:
            raise CleaningValidationError("Invalid conversion action must be leave or null.")
        for row in rows:
            value = row.get(column)
            if self._is_missing(value):
                continue
            try:
                converted = self._convert_value(value, target)
            except (ValueError, InvalidOperation) as error:
                failures.append(self._failure(row, column, value, str(error)))
                if invalid_action == "null":
                    row[column] = None
                    result.affectedRows += 1
                    result.affectedCells += 1
                continue
            if converted != value:
                row[column] = converted
                result.affectedRows += 1
                result.affectedCells += 1
        self._set_column_type(columns, column, target)
        if failures:
            result.warnings.append(f"{len(failures)} value(s) failed conversion.")
        return rows, columns

    def _parse_date(self, rows, columns, operation, result, failures):
        column = self._require_column(operation, columns)
        format_name = str(operation.parameters.get("format", "iso")).lower()
        if format_name not in self._date_formats:
            raise CleaningValidationError("Unsupported date format.")
        invalid_action = str(operation.parameters.get("invalidAction", "null")).lower()
        if invalid_action not in {"leave", "null", "replace", "delete"}:
            raise CleaningValidationError("Invalid date action must be leave, null, replace, or delete.")
        replacement = operation.parameters.get("replacement")
        kept = []
        for row in rows:
            value = row.get(column)
            if self._is_missing(value):
                kept.append(row)
                continue
            try:
                parsed = self._parse_datetime(str(value), format_name)
                converted = parsed.isoformat()
                if converted != value:
                    row[column] = converted
                    result.affectedRows += 1
                    result.affectedCells += 1
                kept.append(row)
            except ValueError:
                failures.append(self._failure(row, column, value, "Date parsing failed."))
                if invalid_action == "delete":
                    result.affectedRows += 1
                    result.rowsRemoved += 1
                    result.destructive = True
                else:
                    if invalid_action == "null": row[column] = None
                    elif invalid_action == "replace": row[column] = replacement
                    if invalid_action in {"null", "replace"}:
                        result.affectedRows += 1
                        result.affectedCells += 1
                    kept.append(row)
        self._set_column_type(columns, column, "datetime")
        return kept, columns

    def _fill_missing(self, rows, columns, operation, result, failures):
        column = self._require_column(operation, columns)
        strategy = str(operation.parameters.get("strategy", "leave")).lower()
        allowed = {"custom", "mean", "median", "zero", "empty", "mode", "forward_fill", "backward_fill", "delete_rows", "leave"}
        if strategy not in allowed:
            raise CleaningValidationError(f"Unsupported missing-value strategy '{strategy}'.")
        if strategy == "leave":
            return rows, columns
        if strategy == "delete_rows":
            kept = [row for row in rows if not self._is_missing(row.get(column))]
            result.rowsRemoved = len(rows) - len(kept)
            result.affectedRows = result.rowsRemoved
            result.destructive = result.rowsRemoved > 0
            return kept, columns
        present = [row.get(column) for row in rows if not self._is_missing(row.get(column))]
        fill_value: Any = None
        if strategy == "custom": fill_value = operation.parameters.get("value")
        elif strategy == "zero": fill_value = 0
        elif strategy == "empty": fill_value = ""
        elif strategy in {"mean", "median"}:
            numbers = [float(Decimal(str(value).strip())) for value in present if self._is_decimal(value)]
            if not numbers: raise CleaningValidationError(f"Cannot calculate {strategy} without numeric values.")
            fill_value = statistics.mean(numbers) if strategy == "mean" else statistics.median(numbers)
        elif strategy == "mode":
            if not present: raise CleaningValidationError("Cannot calculate mode without values.")
            counts: dict[str, tuple[Any, int]] = {}
            for value in present:
                key = str(value)
                counts[key] = (value, counts.get(key, (value, 0))[1] + 1)
            fill_value = sorted(counts.values(), key=lambda item: (-item[1], str(item[0])))[0][0]
        if strategy in {"forward_fill", "backward_fill"}:
            indices = range(len(rows)) if strategy == "forward_fill" else range(len(rows) - 1, -1, -1)
            last: Any = None
            for index in indices:
                value = rows[index].get(column)
                if self._is_missing(value) and not self._is_missing(last):
                    rows[index][column] = last
                    result.affectedRows += 1
                    result.affectedCells += 1
                elif not self._is_missing(value):
                    last = value
            return rows, columns
        for row in rows:
            if self._is_missing(row.get(column)):
                row[column] = fill_value
                result.affectedRows += 1
                result.affectedCells += 1
        return rows, columns

    def _handle_outliers(self, rows, columns, operation, result, failures):
        column = self._require_column(operation, columns)
        action = str(operation.parameters.get("action", "keep")).lower()
        if action not in {"keep", "cap", "median", "delete"}:
            raise CleaningValidationError("Outlier action must be keep, cap, median, or delete.")
        if action == "keep": return rows, columns
        multiplier = float(operation.parameters.get("iqrMultiplier", 1.5))
        if not 0.5 <= multiplier <= 5:
            raise CleaningValidationError("IQR multiplier must be between 0.5 and 5.")
        numeric = sorted(float(Decimal(str(row.get(column)))) for row in rows if self._is_decimal(row.get(column)))
        if len(numeric) < 4:
            raise CleaningValidationError("At least four numeric values are required for IQR outlier handling.")
        q1, q3 = self._percentile(numeric, 0.25), self._percentile(numeric, 0.75)
        lower, upper = q1 - multiplier * (q3 - q1), q3 + multiplier * (q3 - q1)
        median = statistics.median(numeric)
        kept = []
        for row in rows:
            value = row.get(column)
            if not self._is_decimal(value):
                kept.append(row)
                continue
            number = float(Decimal(str(value)))
            if lower <= number <= upper:
                kept.append(row)
                continue
            result.affectedRows += 1
            if action == "delete":
                result.rowsRemoved += 1
                result.destructive = True
                continue
            replacement = min(max(number, lower), upper) if action == "cap" else median
            row[column] = replacement
            result.affectedCells += 1
            kept.append(row)
        result.warnings.append(f"IQR rule used multiplier {multiplier:g} with bounds {lower:g} to {upper:g}.")
        return kept, columns

    def _remove_duplicates(self, rows, columns, operation, result, failures):
        keep = str(operation.parameters.get("keep", "first")).lower()
        if keep not in {"first", "last"}:
            raise CleaningValidationError("Duplicate strategy must keep first or last.")
        subset = operation.parameters.get("columns") or [column.name for column in columns]
        if not isinstance(subset, list) or not subset:
            raise CleaningValidationError("At least one duplicate-identifying column is required.")
        known = {column.name for column in columns}
        if any(name not in known for name in subset):
            raise CleaningValidationError("Duplicate-identifying columns contain an unknown column.")
        indices = range(len(rows)) if keep == "first" else range(len(rows) - 1, -1, -1)
        seen, kept_indices = set(), set()
        for index in indices:
            key = tuple(self._hashable(rows[index].get(name)) for name in subset)
            if key not in seen:
                seen.add(key)
                kept_indices.add(index)
        kept = [row for index, row in enumerate(rows) if index in kept_indices]
        result.rowsRemoved = len(rows) - len(kept)
        result.affectedRows = result.rowsRemoved
        result.destructive = result.rowsRemoved > 0
        return kept, columns

    def _delete_rows(self, rows, columns, operation, result, failures):
        numbers = operation.parameters.get("rowNumbers")
        if not isinstance(numbers, list) or not all(isinstance(value, int) and value > 0 for value in numbers):
            raise CleaningValidationError("rowNumbers must contain positive integers.")
        selected = set(numbers)
        kept = [row for row in rows if row["__rowNumber"] not in selected]
        result.rowsRemoved = len(rows) - len(kept)
        result.affectedRows = result.rowsRemoved
        result.destructive = result.rowsRemoved > 0
        return kept, columns

    def _delete_rows_condition(self, rows, columns, operation, result, failures):
        column = self._require_column(operation, columns)
        operator = str(operation.parameters.get("operator", "equals")).lower()
        allowed = {"equals", "not_equals", "contains", "greater_than", "less_than", "is_missing"}
        if operator not in allowed:
            raise CleaningValidationError("Unsupported row condition operator.")
        expected = operation.parameters.get("value")
        def matches(value: Any) -> bool:
            if operator == "is_missing": return self._is_missing(value)
            if operator == "equals": return value == expected or str(value) == str(expected)
            if operator == "not_equals": return not (value == expected or str(value) == str(expected))
            if operator == "contains": return str(expected) in str(value)
            if operator in {"greater_than", "less_than"}:
                if not self._is_decimal(value) or not self._is_decimal(expected): return False
                return Decimal(str(value)) > Decimal(str(expected)) if operator == "greater_than" else Decimal(str(value)) < Decimal(str(expected))
            return False
        kept = [row for row in rows if not matches(row.get(column))]
        result.rowsRemoved = len(rows) - len(kept)
        result.affectedRows = result.rowsRemoved
        result.destructive = result.rowsRemoved > 0
        return kept, columns

    def _delete_column(self, rows, columns, operation, result, failures):
        column = self._require_column(operation, columns)
        if len(columns) <= 1:
            raise CleaningValidationError("The final dataset column cannot be deleted.")
        for row in rows:
            if column in row:
                row.pop(column)
                result.affectedRows += 1
                result.affectedCells += 1
        result.columnsRemoved = 1
        result.destructive = True
        return rows, [item for item in columns if item.name != column]

    @staticmethod
    def _tag_row(row: dict[str, Any], number: int) -> dict[str, Any]:
        tagged = dict(row)
        tagged["__rowNumber"] = number
        return tagged

    @staticmethod
    def _strip_tag(row: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in row.items() if key != "__rowNumber"}

    @staticmethod
    def _is_missing(value: Any) -> bool:
        return value is None or (isinstance(value, str) and not value.strip())

    @staticmethod
    def _is_decimal(value: Any) -> bool:
        if isinstance(value, bool) or value is None: return False
        try:
            Decimal(str(value).strip())
            return True
        except (InvalidOperation, ValueError):
            return False

    @staticmethod
    def _hashable(value: Any) -> str:
        return repr(value)

    @staticmethod
    def _percentile(values: list[float], percentile: float) -> float:
        position = (len(values) - 1) * percentile
        lower, upper = math.floor(position), math.ceil(position)
        if lower == upper: return values[lower]
        return values[lower] + (values[upper] - values[lower]) * (position - lower)

    def _require_column(self, operation: CleaningOperation, columns: list[CleaningColumn]) -> str:
        if not operation.column:
            raise CleaningValidationError(f"Operation '{operation.operationType}' requires a column.")
        match = next((column.name for column in columns if column.name.lower() == operation.column.lower()), None)
        if match is None:
            raise CleaningValidationError(f"Column '{operation.column}' does not exist.")
        return match

    @staticmethod
    def _set_column_type(columns: list[CleaningColumn], name: str, data_type: str) -> None:
        for column in columns:
            if column.name == name:
                column.dataType = data_type

    @staticmethod
    def _failure(row: dict[str, Any], column: str, value: Any, reason: str) -> ConversionFailure:
        return ConversionFailure(rowNumber=row["__rowNumber"], column=column, value=value, reason=reason)

    def _parse_datetime(self, value: str, format_name: str) -> datetime:
        value = value.strip()
        if format_name == "iso":
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return datetime.strptime(value, self._date_formats[format_name])

    def _convert_value(self, value: Any, target: str) -> Any:
        text = str(value).strip()
        if target == "string": return str(value)
        if target == "integer":
            number = Decimal(text)
            if number != number.to_integral_value(): raise ValueError("Value is not a whole number.")
            return int(number)
        if target == "decimal": return float(Decimal(text))
        if target == "boolean":
            normalized = text.lower()
            if normalized in {"true", "yes", "1"}: return True
            if normalized in {"false", "no", "0"}: return False
            raise ValueError("Value is not a supported boolean.")
        if target == "datetime": return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
        raise ValueError("Unsupported target type.")

