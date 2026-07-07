"""Small wrapper around the core type detection helper."""

from typing import Any

from services.analysis_service import AnalysisService


class TypeDetectorService:
    """Expose type detection as its own service for integration compatibility."""

    def detect_type(self, values: list[Any]) -> str:
        """Delegate to the shared AnalysisService implementation."""
        return AnalysisService()._detect_type(values)

