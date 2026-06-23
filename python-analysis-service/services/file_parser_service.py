from typing import Any


class FileParserService:
    def parse_file(self, file_content: bytes, file_name: str) -> dict[str, Any]:
        raise NotImplementedError

