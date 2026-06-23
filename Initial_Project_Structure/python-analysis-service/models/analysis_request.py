from typing import Any

from pydantic import BaseModel, Field


class DatasetInput(BaseModel):
    datasetId: int
    tableName: str
    columns: list[str] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)


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
