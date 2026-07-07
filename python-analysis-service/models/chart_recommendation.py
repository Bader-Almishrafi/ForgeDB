from pydantic import BaseModel, Field


class ChartRecommendation(BaseModel):
    title: str
    chartType: str
    datasetName: str
    xAxis: str
    yAxis: str
    aggregation: str
    description: str


class ChartRecommendationResponse(BaseModel):
    projectId: int
    charts: list[ChartRecommendation] = Field(default_factory=list)

