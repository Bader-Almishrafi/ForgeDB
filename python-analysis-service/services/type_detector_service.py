from typing import Any


class TypeDetectorService:
    def detect_type(self, values: list[Any]) -> str:
        raise NotImplementedError

