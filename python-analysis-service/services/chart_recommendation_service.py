from models.analysis_request import AnalysisRequest
from models.chart_recommendation import ChartRecommendation, ChartRecommendationResponse


class ChartRecommendationService:
    def recommend_charts(self, request: AnalysisRequest) -> ChartRecommendationResponse:
        return ChartRecommendationResponse(
            projectId=request.projectId,
            charts=[
                ChartRecommendation(
                    title="Rows by Table",
                    chartType="bar",
                    datasetName="orders",
                    xAxis="status",
                    yAxis="count",
                    aggregation="count",
                    description="Shows the number of records grouped by status.",
                )
            ],
        )

