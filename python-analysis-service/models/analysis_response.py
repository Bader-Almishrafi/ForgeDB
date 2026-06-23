from typing import Any

from pydantic import BaseModel, Field


class ColumnProfile(BaseModel):
    columnName: str
    detectedDataType: str
    missingValuesCount: int
    uniqueValuesCount: int
    isNullable: bool
    sampleValues: list[Any] = Field(default_factory=list)


class DatasetProfile(BaseModel):
    datasetId: int
    tableName: str
    rowCount: int
    columnCount: int
    missingValuesCount: int
    duplicateRowsCount: int
    columns: list[ColumnProfile] = Field(default_factory=list)


class ProfileAnalysisResponse(BaseModel):
    projectId: int
    datasets: list[DatasetProfile] = Field(default_factory=list)


class RelationshipResponse(BaseModel):
    fromTable: str
    fromColumn: str
    toTable: str
    toColumn: str
    confidence: float


class RelationshipsAnalysisResponse(BaseModel):
    projectId: int
    relationships: list[RelationshipResponse] = Field(default_factory=list)


class FullAnalysisResponse(BaseModel):
    projectId: int
    profile: dict[str, Any] = Field(default_factory=dict)
    relationships: list[RelationshipResponse] = Field(default_factory=list)
    dbmlContent: str
    schemaJson: dict[str, Any] = Field(default_factory=dict)
    sqlContent: str
    charts: list[Any] = Field(default_factory=list)

