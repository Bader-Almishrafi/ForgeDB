"""API router for the analysis workflow endpoints.

These routes expose smaller workflow steps and one combined full-analysis route
so the backend can call only the stage it needs.
"""

from fastapi import APIRouter

from models.analysis_request import AnalysisRequest, FullAnalysisRequest, SchemaGenerationRequest
from models.analysis_response import FullAnalysisResponse, ProfileAnalysisResponse, RelationshipsAnalysisResponse
from models.chart_recommendation import ChartRecommendationResponse
from models.schema_response import SchemaResponse
from services.chart_recommendation_service import ChartRecommendationService
from services.data_profiler_service import DataProfilerService
from services.dbml_generator_service import DbmlGeneratorService
from services.relationship_detector_service import RelationshipDetectorService

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

# Services are kept at module scope because they are stateless and inexpensive.
data_profiler_service = DataProfilerService()
relationship_detector_service = RelationshipDetectorService()
dbml_generator_service = DbmlGeneratorService()
chart_recommendation_service = ChartRecommendationService()


@router.post("/profile", response_model=ProfileAnalysisResponse)
async def profile(request: AnalysisRequest) -> ProfileAnalysisResponse:
    return data_profiler_service.profile_datasets(request)


@router.post("/relationships", response_model=RelationshipsAnalysisResponse)
async def relationships(request: AnalysisRequest) -> RelationshipsAnalysisResponse:
    return relationship_detector_service.detect_relationships(request)


@router.post("/generate-schema", response_model=SchemaResponse)
async def generate_schema(request: SchemaGenerationRequest) -> SchemaResponse:
    return dbml_generator_service.generate_schema(request)


@router.post("/recommend-charts", response_model=ChartRecommendationResponse)
async def recommend_charts(request: AnalysisRequest) -> ChartRecommendationResponse:
    return chart_recommendation_service.recommend_charts(request)


@router.post("/full-analysis", response_model=FullAnalysisResponse)
async def full_analysis(request: FullAnalysisRequest) -> FullAnalysisResponse:
    profile_response = data_profiler_service.profile_datasets(request)
    relationships_response = relationship_detector_service.detect_relationships(request)
    schema_response = dbml_generator_service.generate_schema(
        SchemaGenerationRequest(
            projectId=request.projectId,
            schemaName=request.schemaName,
            datasets=request.datasets,
            relationships=[relationship.model_dump() for relationship in relationships_response.relationships],
        )
    )
    chart_response = chart_recommendation_service.recommend_charts(request)

    return FullAnalysisResponse(
        projectId=request.projectId,
        profile=profile_response.model_dump(),
        relationships=relationships_response.relationships,
        dbmlContent=schema_response.dbmlContent,
        schemaJson=schema_response.schemaJson,
        sqlContent=schema_response.sqlContent,
        charts=chart_response.charts,
    )
