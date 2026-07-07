from models.analysis_request import AnalysisRequest
from models.analysis_response import RelationshipResponse, RelationshipsAnalysisResponse
from services.analysis_service import AnalysisService


class RelationshipDetectorService:
    def detect_relationships(self, request: AnalysisRequest) -> RelationshipsAnalysisResponse:
        analysis_service = AnalysisService()
        relationships: list[RelationshipResponse] = []

        for dataset in request.datasets:
            analysis = analysis_service.analyze(dataset.to_analyze_request())
            relationships.extend(
                RelationshipResponse(
                    fromTable=suggestion.fromTable,
                    fromColumn=suggestion.fromColumn,
                    toTable=suggestion.toTable,
                    toColumn=suggestion.toColumn,
                    confidence=suggestion.confidence,
                )
                for suggestion in analysis.relationshipSuggestions
            )

        return RelationshipsAnalysisResponse(
            projectId=request.projectId,
            relationships=relationships,
        )

