"""Service that converts analysis chart ideas into dashboard chart responses."""

from models.analysis_request import AnalysisRequest
from models.chart_recommendation import ChartRecommendation, ChartRecommendationResponse
from services.analysis_service import AnalysisService


class ChartRecommendationService:
    """Build project-level chart recommendations from dataset analysis results."""

    def recommend_charts(self, request: AnalysisRequest) -> ChartRecommendationResponse:
        """Analyze each dataset and flatten its chart suggestions into one response."""
        charts: list[ChartRecommendation] = []
        analysis_service = AnalysisService()

        for dataset in request.datasets:
            analyze_request = dataset.to_analyze_request()
            analysis = analysis_service.analyze(analyze_request)
            # Convert internal recommendation fields to the dashboard response model.
            charts.extend(
                ChartRecommendation(
                    title=chart.title,
                    chartType=chart.chartType,
                    datasetName=dataset.tableName,
                    xAxis=chart.xColumn,
                    yAxis=chart.yColumn or "",
                    aggregation="none",
                    description=chart.reason,
                )
                for chart in analysis.chartRecommendations
            )

        return ChartRecommendationResponse(
            projectId=request.projectId,
            charts=charts,
        )

