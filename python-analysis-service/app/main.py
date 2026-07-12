from fastapi import FastAPI

from models.analysis_request import AnalyzeRequest
from models.analysis_response import AnalyzeResponse
from models.cleaning import CleaningRequest, CleaningResponse
from routers.analysis_router import router as legacy_analysis_router
from services.analysis_service import AnalysisService
from services.cleaning_service import CleaningService

app = FastAPI(
    title="ForgeDB Python Analysis Service",
    version="0.1.0",
)

analysis_service = AnalysisService()
cleaning_service = CleaningService()


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "healthy",
        "service": "ForgeDB Python Analysis Service",
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    return analysis_service.analyze(request)


@app.post("/cleaning/preview", response_model=CleaningResponse)
async def preview_cleaning(request: CleaningRequest) -> CleaningResponse:
    return cleaning_service.execute(request)


@app.post("/cleaning/apply", response_model=CleaningResponse)
async def apply_cleaning(request: CleaningRequest) -> CleaningResponse:
    return cleaning_service.execute(request)


app.include_router(legacy_analysis_router)
