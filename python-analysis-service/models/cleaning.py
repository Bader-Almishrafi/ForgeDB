from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class CleaningColumn(BaseModel):
    name: str
    dataType: str = "string"

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Column name is required.")
        return value


class CleaningOperation(BaseModel):
    operationId: str | None = None
    operationType: str
    column: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)

    @field_validator("operationType")
    @classmethod
    def normalize_operation_type(cls, value: str) -> str:
        value = value.strip().lower()
        if not value:
            raise ValueError("Operation type is required.")
        return value

    @field_validator("column")
    @classmethod
    def normalize_column(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None


class CleaningRequest(BaseModel):
    datasetId: int = Field(gt=0)
    versionId: int = Field(gt=0)
    tableName: str
    columns: list[CleaningColumn]
    rows: list[dict[str, Any]]
    operations: list[CleaningOperation] = Field(min_length=1, max_length=100)

    @field_validator("tableName")
    @classmethod
    def validate_table_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Table name is required.")
        return value

    @model_validator(mode="after")
    def validate_shape(self) -> "CleaningRequest":
        if not self.columns:
            raise ValueError("At least one column is required.")
        if len(self.rows) > 100_000:
            raise ValueError("Cleaning requests are limited to 100,000 rows.")
        names = [column.name.lower() for column in self.columns]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate column names are not allowed.")
        return self


class ConversionFailure(BaseModel):
    rowNumber: int
    column: str
    value: Any = None
    reason: str


class CleaningPreviewRow(BaseModel):
    rowNumber: int
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None


class CleaningOperationResult(BaseModel):
    operationId: str
    operationType: str
    column: str | None = None
    affectedRows: int = 0
    affectedCells: int = 0
    rowsRemoved: int = 0
    columnsRemoved: int = 0
    columnsRenamed: int = 0
    destructive: bool = False
    warnings: list[str] = Field(default_factory=list)


class CleaningResponse(BaseModel):
    datasetId: int
    sourceVersionId: int
    executionOrder: list[str]
    columns: list[CleaningColumn]
    resultRows: list[dict[str, Any]]
    previewRows: list[CleaningPreviewRow]
    operationResults: list[CleaningOperationResult]
    affectedRows: int
    affectedCells: int
    rowsRemoved: int
    columnsRemoved: int
    columnsRenamed: int
    conversionFailures: list[ConversionFailure]
    warnings: list[str]
    destructive: bool

