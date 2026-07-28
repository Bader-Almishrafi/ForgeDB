from __future__ import annotations

import math
from datetime import datetime
from decimal import Decimal, InvalidOperation, localcontext
from typing import Any

from models.analysis_request import AnalyzeRequest, ColumnInput
from models.analysis_response import (
    AnalyzeChartRecommendation,
    AnalyzeColumnProfile,
    AnalyzeResponse,
    NumericStats,
    RelationshipSuggestion,
    TopValueSummary,
)

DOTNET_DECIMAL_MAX = Decimal("79228162514264337593543950335")
DOTNET_DECIMAL_MIN = -DOTNET_DECIMAL_MAX


class AnalysisService:
    sample_value_limit = 5
    top_value_limit = 5

    def analyze(self, request: AnalyzeRequest) -> AnalyzeResponse:
        column_profiles = [self._profile_column(column, request.rows) for column in request.columns]

        return AnalyzeResponse(
            datasetId=request.datasetId,
            tableName=request.tableName,
            rowCount=len(request.rows),
            columnCount=len(request.columns),
            missingValuesCount=sum(column.missingCount for column in column_profiles),
            duplicateRowsCount=self._count_duplicate_rows(request.rows, request.columns),
            columns=column_profiles,
            relationshipSuggestions=self._suggest_relationships(request.tableName, request.columns),
            chartRecommendations=self._recommend_charts(column_profiles),
        )

    def _profile_column(self, column: ColumnInput, rows: list[dict[str, Any]]) -> AnalyzeColumnProfile:
        raw_values = [row.get(column.name) for row in rows]
        present_values = [value for value in raw_values if not self._is_missing(value)]
        detected_type = self._detect_type(present_values, column.dataType)
        normalized_values = [self._normalize_value(value) for value in present_values]
        unique_values = {self._stable_value_key(value) for value in normalized_values}
        sample_values: list[Any] = []
        sampled_keys: set[tuple[Any, ...]] = set()
        for value in normalized_values:
            value_key = self._stable_value_key(value)
            if value_key in sampled_keys:
                continue
            sampled_keys.add(value_key)
            sample_values.append(value)
            if len(sample_values) == self.sample_value_limit:
                break

        numeric_stats = self._numeric_stats(present_values) if detected_type in {"integer", "decimal"} else None
        top_values = self._top_values(normalized_values) if detected_type == "string" else []

        return AnalyzeColumnProfile(
            name=column.name,
            detectedType=detected_type,
            missingCount=len(raw_values) - len(present_values),
            uniqueCount=len(unique_values),
            sampleValues=sample_values,
            numericStats=numeric_stats,
            topValues=top_values,
        )

    def _detect_type(self, values: list[Any], requested_type: str | None = None) -> str:
        if not values:
            return self._normalize_declared_type(requested_type) or "string"

        if all(self._can_parse_integer(value) for value in values):
            return "integer"

        if all(self._can_parse_decimal(value) for value in values):
            return "decimal"

        if all(self._can_parse_boolean(value) for value in values):
            return "boolean"

        if all(self._can_parse_datetime(value) for value in values):
            return "datetime"

        return self._normalize_declared_type(requested_type) or "string"

    def _numeric_stats(self, values: list[Any]) -> NumericStats | None:
        numbers = [Decimal(str(value).strip()) for value in values if self._can_parse_decimal(value)]
        if not numbers:
            return None

        try:
            minimum = min(numbers)
            maximum = max(numbers)
            if minimum < DOTNET_DECIMAL_MIN or maximum > DOTNET_DECIMAL_MAX:
                return None
            with localcontext() as context:
                context.prec = 64
                average = sum(numbers, Decimal(0)) / Decimal(len(numbers))
            return NumericStats(
                min=self._decimal_to_number(minimum),
                max=self._decimal_to_number(maximum),
                average=self._decimal_to_number(average),
            )
        except (ArithmeticError, OverflowError, ValueError):
            return None

    def _top_values(self, values: list[Any]) -> list[TopValueSummary]:
        counts: dict[tuple[Any, ...], tuple[Any, int]] = {}
        for value in values:
            value_key = self._stable_value_key(value)
            first_value, count = counts.get(value_key, (value, 0))
            counts[value_key] = (first_value, count + 1)

        return [
            TopValueSummary(value=value, count=count)
            for _, (value, count) in sorted(
                counts.items(),
                key=lambda item: (-item[1][1], repr(item[0])),
            )[: self.top_value_limit]
        ]

    def _suggest_relationships(self, table_name: str, columns: list[ColumnInput]) -> list[RelationshipSuggestion]:
        suggestions: list[RelationshipSuggestion] = []

        for column in columns:
            name = column.name.strip()
            lower_name = name.lower()

            if lower_name == "id":
                suggestions.append(
                    RelationshipSuggestion(
                        fromTable=table_name,
                        fromColumn=name,
                        toTable=table_name,
                        toColumn="id",
                        confidence=0.4,
                        reason="Column name is a primary-key style identifier",
                    )
                )
                continue

            if lower_name.endswith("_id") and len(lower_name) > 3:
                entity_name = lower_name[:-3]
                suggestions.append(
                    RelationshipSuggestion(
                        fromTable=table_name,
                        fromColumn=name,
                        toTable=self._pluralize(entity_name),
                        toColumn="id",
                        confidence=0.7,
                        reason="Column name looks like a foreign key",
                    )
                )
                continue

            if "id" in lower_name and lower_name != "id":
                suggestions.append(
                    RelationshipSuggestion(
                        fromTable=table_name,
                        fromColumn=name,
                        toTable=f"{lower_name.replace('id', '').strip('_') or 'related'}s",
                        toColumn="id",
                        confidence=0.55,
                        reason="Column name contains an identifier pattern",
                    )
                )

        return suggestions

    def _recommend_charts(self, columns: list[AnalyzeColumnProfile]) -> list[AnalyzeChartRecommendation]:
        recommendations: list[AnalyzeChartRecommendation] = []
        numeric_columns = [column for column in columns if column.detectedType in {"integer", "decimal"}]
        text_columns = [column for column in columns if column.detectedType == "string"]
        datetime_columns = [column for column in columns if column.detectedType == "datetime"]

        for column in numeric_columns[:3]:
            recommendations.append(
                AnalyzeChartRecommendation(
                    chartType="histogram",
                    title=f"{column.name} distribution",
                    xColumn=column.name,
                    reason="Numeric column can be shown as a distribution",
                )
            )

        for column in text_columns:
            has_repeated_values = any(top_value.count > 1 for top_value in column.topValues)
            recommendations.append(
                AnalyzeChartRecommendation(
                    chartType="bar",
                    title=f"Top values by {column.name}",
                    xColumn=column.name,
                    reason="Text column with repeated values"
                    if has_repeated_values
                    else "Text column can be summarized by value counts",
                )
            )

        if len(numeric_columns) >= 2:
            recommendations.append(
                AnalyzeChartRecommendation(
                    chartType="scatter",
                    title=f"{numeric_columns[0].name} vs {numeric_columns[1].name}",
                    xColumn=numeric_columns[0].name,
                    yColumn=numeric_columns[1].name,
                    reason="Two numeric columns can be compared",
                )
            )

        if datetime_columns and numeric_columns:
            recommendations.append(
                AnalyzeChartRecommendation(
                    chartType="line",
                    title=f"{numeric_columns[0].name} over {datetime_columns[0].name}",
                    xColumn=datetime_columns[0].name,
                    yColumn=numeric_columns[0].name,
                    reason="Datetime and numeric columns can show change over time",
                )
            )

        return recommendations

    def _count_duplicate_rows(self, rows: list[dict[str, Any]], columns: list[ColumnInput]) -> int:
        seen_rows: set[tuple[Any, ...]] = set()
        duplicate_count = 0

        for row in rows:
            row_key = tuple(
                self._stable_value_key(self._normalize_value(row.get(column.name)))
                for column in columns
            )
            if row_key in seen_rows:
                duplicate_count += 1
            else:
                seen_rows.add(row_key)

        return duplicate_count

    @staticmethod
    def _is_missing(value: Any) -> bool:
        return value is None or (isinstance(value, str) and not value.strip())

    @classmethod
    def _normalize_value(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()

        if isinstance(value, float):
            if math.isnan(value):
                return "NaN"
            if math.isinf(value):
                return "Infinity" if value > 0 else "-Infinity"
            return value

        if isinstance(value, Decimal):
            if not value.is_finite():
                return str(value)
            if value == value.to_integral_value() and value.adjusted() <= 1_000:
                return int(value)
            converted = float(value)
            return converted if math.isfinite(converted) else str(value)

        if isinstance(value, dict):
            return {
                str(key): cls._normalize_value(nested_value)
                for key, nested_value in sorted(
                    value.items(),
                    key=lambda item: (type(item[0]).__name__, str(item[0])),
                )
            }

        if isinstance(value, (list, tuple)):
            return [cls._normalize_value(item) for item in value]

        if isinstance(value, (set, frozenset)):
            normalized_items = [cls._normalize_value(item) for item in value]
            return sorted(normalized_items, key=lambda item: repr(cls._stable_value_key(item)))

        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")

        if value is None or isinstance(value, (bool, int)):
            return value

        return str(value)

    @classmethod
    def _stable_value_key(cls, value: Any) -> tuple[Any, ...]:
        normalized = cls._normalize_value(value)

        if normalized is None:
            return ("null",)
        if isinstance(normalized, (bool, int, float)):
            return ("number", normalized)
        if isinstance(normalized, str):
            return ("string", normalized)
        if isinstance(normalized, dict):
            return (
                "object",
                tuple(
                    (key, cls._stable_value_key(nested_value))
                    for key, nested_value in normalized.items()
                ),
            )
        if isinstance(normalized, list):
            return ("array", tuple(cls._stable_value_key(item) for item in normalized))

        return ("other", repr(normalized))

    @staticmethod
    def _normalize_declared_type(value: str | None) -> str | None:
        if value is None:
            return None

        normalized = value.strip().lower()
        if normalized in {"int", "integer"}:
            return "integer"
        if normalized in {"decimal", "double", "float", "number", "numeric"}:
            return "decimal"
        if normalized in {"bool", "boolean"}:
            return "boolean"
        if normalized in {"date", "datetime", "timestamp"}:
            return "datetime"
        if normalized in {"str", "string", "text"}:
            return "string"

        return None

    @staticmethod
    def _can_parse_integer(value: Any) -> bool:
        if isinstance(value, bool):
            return False

        try:
            text = str(value).strip()
            return bool(text) and str(int(text)) == text
        except (TypeError, ValueError):
            return False

    @staticmethod
    def _can_parse_decimal(value: Any) -> bool:
        if isinstance(value, bool):
            return False

        try:
            number = Decimal(str(value).strip())
            return number.is_finite()
        except (InvalidOperation, ValueError):
            return False

    @staticmethod
    def _can_parse_boolean(value: Any) -> bool:
        if isinstance(value, bool):
            return True

        return str(value).strip().lower() in {"true", "false", "yes", "no", "1", "0"}

    @staticmethod
    def _can_parse_datetime(value: Any) -> bool:
        text = str(value).strip()
        if not text:
            return False

        try:
            datetime.fromisoformat(text.replace("Z", "+00:00"))
            return True
        except ValueError:
            return False

    @staticmethod
    def _decimal_to_number(value: Decimal) -> float | int:
        if not value.is_finite():
            raise ValueError("Non-finite numeric values are not supported.")
        if value < DOTNET_DECIMAL_MIN or value > DOTNET_DECIMAL_MAX:
            raise OverflowError("Numeric value is outside the .NET decimal range.")

        if value == value.to_integral_value():
            return int(value)

        converted = float(value)
        if not math.isfinite(converted):
            raise OverflowError("Numeric value is too large to serialize safely.")
        converted_decimal = Decimal(str(converted))
        if converted_decimal < DOTNET_DECIMAL_MIN or converted_decimal > DOTNET_DECIMAL_MAX:
            raise OverflowError("Serialized numeric value is outside the .NET decimal range.")

        return converted

    @staticmethod
    def _pluralize(value: str) -> str:
        if value.endswith("y") and len(value) > 1:
            return f"{value[:-1]}ies"

        if value.endswith("s"):
            return value

        return f"{value}s"
