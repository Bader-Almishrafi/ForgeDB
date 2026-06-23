from typing import Any

from pydantic import BaseModel, Field


class SchemaResponse(BaseModel):
    projectId: int
    schemaName: str
    dbmlContent: str
    schemaJson: dict[str, Any] = Field(default_factory=dict)
    sqlContent: str

