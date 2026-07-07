"""Request models accepted by the Python analysis endpoints.

These Pydantic models define the contract between the ASP.NET Core backend
and the Python service. They validate incoming dataset metadata before any
profiling, relationship detection, or schema generation starts.
"""

from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class ColumnInput(BaseModel):
    """Metadata for one source column sent by the backend."""

    name: str
    dataType: str | None = None

    @field_validator("name")
    @classmethod
    def name_is_required(cls, value: str) -> str:
        """Reject empty column names before analysis runs."""
        if not value or not value.strip():
            raise ValueError("Column name is required.")

        return value.strip()

    @field_validator("dataType")
    @classmethod
    def data_type_is_normalized(cls, value: str | None) -> str | None:
        """Normalize optional backend-provided data type hints."""
        if value is None or not value.strip():
            return None

        return value.strip().lower()


class AnalyzeRequest(BaseModel):
    datasetId: int = Field(gt=0)
    tableName: str
    columns: list[ColumnInput] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("tableName")
    @classmethod
    def table_name_is_required(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("Table name is required.")

        return value.strip()

    @model_validator(mode="after")
    def columns_are_valid(self) -> "AnalyzeRequest":
        if not self.columns:
            raise ValueError("At least one column is required.")

        seen_columns = set()
        for column in self.columns:
            normalized_name = column.name.lower()
            if normalized_name in seen_columns:
                raise ValueError(f"Duplicate column name '{column.name}' is not allowed.")

            seen_columns.add(normalized_name)

        return self


class DatasetInput(BaseModel):
    datasetId: int
    tableName: str
    columns: list[str | ColumnInput] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)

    def to_analyze_request(self) -> AnalyzeRequest:
        columns = [
            column if isinstance(column, ColumnInput) else ColumnInput(name=column)
            for column in self.columns
        ]

        return AnalyzeRequest(
            datasetId=self.datasetId,
            tableName=self.tableName,
            columns=columns,
            rows=self.rows,
        )


class AnalysisRequest(BaseModel):
    projectId: int
    datasets: list[DatasetInput] = Field(default_factory=list)


class RelationshipInput(BaseModel):
    fromTable: str
    fromColumn: str
    toTable: str
    toColumn: str
    confidence: float


class SchemaGenerationRequest(AnalysisRequest):
    schemaName: str
    relationships: list[RelationshipInput] = Field(default_factory=list)


class FullAnalysisRequest(AnalysisRequest):
    schemaName: str
