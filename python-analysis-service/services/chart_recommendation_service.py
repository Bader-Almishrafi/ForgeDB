from models.analysis_request import AnalysisRequest
from models.chart_recommendation import ChartRecommendation, ChartRecommendationResponse
from services.analysis_service import AnalysisService


class ChartRecommendationService:
    def recommend_charts(self, request: AnalysisRequest) -> ChartRecommendationResponse:
        charts: list[ChartRecommendation] = []
        analysis_service = AnalysisService()

        for dataset in request.datasets:
            analyze_request = dataset.to_analyze_request()
            analysis = analysis_service.analyze(analyze_request)
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

