"""FastAPI application setup for the ForgeDB Python Analysis Service.

The backend calls this service to analyze imported datasets and receive
profiles, relationship suggestions, chart recommendations, and schema data.
"""

from fastapi import FastAPI

from models.analysis_request import AnalyzeRequest
from models.analysis_response import AnalyzeResponse
from routers.analysis_router import router as legacy_analysis_router
from services.analysis_service import AnalysisService

app = FastAPI(
    title="ForgeDB Python Analysis Service",
    version="0.1.0",
)

# A single service instance is reused by the lightweight endpoint handlers.
analysis_service = AnalysisService()


@app.get("/health")
async def health() -> dict[str, str]:
    """Return a minimal health response for startup checks."""
    return {
        "status": "healthy",
        "service": "ForgeDB Python Analysis Service",
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    """Analyze a single dataset using the current analysis pipeline."""
    return analysis_service.analyze(request)


app.include_router(legacy_analysis_router)
