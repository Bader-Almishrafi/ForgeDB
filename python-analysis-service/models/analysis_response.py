"""Response models returned by the Python analysis service.

The fields here mirror what the ASP.NET Core backend expects to store or show
in the ForgeDB dashboard, schema review, and relationship screens.
"""

from typing import Any

from pydantic import BaseModel, Field


class NumericStats(BaseModel):
    """Basic numeric summary for integer and decimal columns."""

    min: int | float
    max: int | float
    average: int | float


class TopValueSummary(BaseModel):
    """Most frequent value summary used for categorical columns."""

    value: Any
    count: int


class AnalyzeColumnProfile(BaseModel):
    """Complete profiling result for a single dataset column."""

    name: str
    detectedType: str
    missingCount: int
    uniqueCount: int
    sampleValues: list[Any] = Field(default_factory=list)
    numericStats: NumericStats | None = None
    topValues: list[TopValueSummary] = Field(default_factory=list)


class RelationshipSuggestion(BaseModel):
    """Potential relationship found from column naming patterns."""

    fromTable: str
    fromColumn: str
    toTable: str
    toColumn: str
    confidence: float
    reason: str


class AnalyzeChartRecommendation(BaseModel):
    """Chart suggestion derived from detected column types."""

    chartType: str
    title: str
    xColumn: str
    yColumn: str | None = None
    reason: str


class AnalyzeResponse(BaseModel):
    """Single-dataset analysis response used by the direct `/analyze` endpoint."""

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
    """Column profile shape returned by project-level profiling endpoints."""

    columnName: str
    detectedDataType: str
    missingValuesCount: int
    uniqueValuesCount: int
    isNullable: bool
    sampleValues: list[Any] = Field(default_factory=list)


class DatasetProfile(BaseModel):
    """Dataset profile shown in dashboard and analysis screens."""

    datasetId: int
    tableName: str
    rowCount: int
    columnCount: int
    missingValuesCount: int
    duplicateRowsCount: int
    columns: list[ColumnProfile] = Field(default_factory=list)


class ProfileAnalysisResponse(BaseModel):
    """Project-level response containing profiles for all submitted datasets."""

    projectId: int
    datasets: list[DatasetProfile] = Field(default_factory=list)


class RelationshipResponse(BaseModel):
    """Relationship response format used by backend schema flows."""

    fromTable: str
    fromColumn: str
    toTable: str
    toColumn: str
    confidence: float


class RelationshipsAnalysisResponse(BaseModel):
    """Collection of relationship suggestions for a project."""

    projectId: int
    relationships: list[RelationshipResponse] = Field(default_factory=list)


class FullAnalysisResponse(BaseModel):
    """Combined response for the full analysis workflow endpoint."""

    projectId: int
    profile: dict[str, Any] = Field(default_factory=dict)
    relationships: list[RelationshipResponse] = Field(default_factory=list)
    dbmlContent: str
    schemaJson: dict[str, Any] = Field(default_factory=dict)
    sqlContent: str
    charts: list[Any] = Field(default_factory=list)

