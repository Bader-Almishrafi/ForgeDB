"""Project-level relationship detection service."""

from models.analysis_request import AnalysisRequest
from models.analysis_response import RelationshipResponse, RelationshipsAnalysisResponse
from services.analysis_service import AnalysisService


class RelationshipDetectorService:
    """Collects relationship suggestions for all datasets in a project."""

    def detect_relationships(self, request: AnalysisRequest) -> RelationshipsAnalysisResponse:
        """Reuse core analysis suggestions and return the public response shape."""
        analysis_service = AnalysisService()
        relationships: list[RelationshipResponse] = []

        for dataset in request.datasets:
            analysis = analysis_service.analyze(dataset.to_analyze_request())
            # Relationship suggestions are intentionally lightweight and reviewable.
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

