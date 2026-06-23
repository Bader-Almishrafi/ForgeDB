from fastapi import FastAPI

from routers.analysis_router import router as analysis_router

app = FastAPI(
    title="ForgeDB Python Analysis Service",
    version="0.1.0",
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "healthy",
        "service": "ForgeDB Python Analysis Service",
    }


app.include_router(analysis_router)

