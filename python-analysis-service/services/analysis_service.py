"""Core dataset analysis logic for ForgeDB.

This service is intentionally independent from FastAPI so it can be reused by
multiple router endpoints and by helper services that need the same profiling
results.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from decimal import Decimal, InvalidOperation
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


class AnalysisService:
    """Analyze rows, infer column metadata, and build lightweight suggestions."""

    # Keep previews small so API responses stay readable for large datasets.
    sample_value_limit = 5
    # Limit top categorical values to avoid large dashboard payloads.
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
        unique_values = set(normalized_values)
        sample_values = list(dict.fromkeys(normalized_values))[: self.sample_value_limit]

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

        average = sum(numbers) / Decimal(len(numbers))

        return NumericStats(
            min=self._decimal_to_number(min(numbers)),
            max=self._decimal_to_number(max(numbers)),
            average=self._decimal_to_number(average),
        )

    def _top_values(self, values: list[Any]) -> list[TopValueSummary]:
        counts = Counter(values)

        return [
            TopValueSummary(value=value, count=count)
            for value, count in sorted(counts.items(), key=lambda item: (-item[1], str(item[0])))[: self.top_value_limit]
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
            row_key = tuple(self._normalize_value(row.get(column.name)) for column in columns)
            if row_key in seen_rows:
                duplicate_count += 1
            else:
                seen_rows.add(row_key)

        return duplicate_count

    @staticmethod
    def _is_missing(value: Any) -> bool:
        return value is None or (isinstance(value, str) and not value.strip())

    @staticmethod
    def _normalize_value(value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()

        return value

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
            Decimal(str(value).strip())
            return True
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
        if value == value.to_integral_value():
            return int(value)

        return float(value)

    @staticmethod
    def _pluralize(value: str) -> str:
        if value.endswith("y") and len(value) > 1:
            return f"{value[:-1]}ies"

        if value.endswith("s"):
            return value

        return f"{value}s"
