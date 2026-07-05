from typing import Any

from pydantic import BaseModel, Field


class NumericStats(BaseModel):
    min: int | float
    max: int | float
    average: int | float


class TopValueSummary(BaseModel):
    value: Any
    count: int


class AnalyzeColumnProfile(BaseModel):
    name: str
    detectedType: str
    missingCount: int
    uniqueCount: int
    sampleValues: list[Any] = Field(default_factory=list)
    numericStats: NumericStats | None = None
    topValues: list[TopValueSummary] = Field(default_factory=list)


class RelationshipSuggestion(BaseModel):
    fromTable: str
    fromColumn: str
    toTable: str
    toColumn: str
    confidence: float
    reason: str


class AnalyzeChartRecommendation(BaseModel):
    chartType: str
    title: str
    xColumn: str
    yColumn: str | None = None
    reason: str


class AnalyzeResponse(BaseModel):
    datasetId: int
    tableName: str
    rowCount: int
    columnCount: int
    missingValuesCount: int
    duplicateRowsCount: int
    columns: list[AnalyzeColumnProfile] = Field(default_factory=list)
    relationshipSuggestions: list[RelationshipSuggestion] = Field(default_factory=list)
    chartRecommendations: list[AnalyzeChartRecommendation] = Field(default_factory=list)


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

