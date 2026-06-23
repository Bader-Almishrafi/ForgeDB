from models.analysis_request import AnalysisRequest
from models.analysis_response import RelationshipResponse, RelationshipsAnalysisResponse


class RelationshipDetectorService:
    def detect_relationships(self, request: AnalysisRequest) -> RelationshipsAnalysisResponse:
        return RelationshipsAnalysisResponse(
            projectId=request.projectId,
            relationships=[
                RelationshipResponse(
                    fromTable="orders",
                    fromColumn="customer_id",
                    toTable="customers",
                    toColumn="id",
                    confidence=0.95,
                )
            ],
        )

