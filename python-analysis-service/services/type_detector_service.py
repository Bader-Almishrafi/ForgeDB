from typing import Any

from services.analysis_service import AnalysisService


class TypeDetectorService:
    def detect_type(self, values: list[Any]) -> str:
        return AnalysisService()._detect_type(values)

