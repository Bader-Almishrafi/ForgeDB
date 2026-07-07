"""Models for chart recommendations displayed by ForgeDB dashboards."""

from pydantic import BaseModel, Field


class ChartRecommendation(BaseModel):
    """Frontend-friendly chart configuration suggestion."""

    title: str
    chartType: str
    datasetName: str
    xAxis: str
    yAxis: str
    aggregation: str
    description: str


class ChartRecommendationResponse(BaseModel):
    """Chart recommendation response for one project."""

    projectId: int
    charts: list[ChartRecommendation] = Field(default_factory=list)

