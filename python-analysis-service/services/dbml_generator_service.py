"""Schema generation service placeholder for DBML, schema JSON, and SQL output."""

from models.analysis_request import SchemaGenerationRequest
from models.schema_response import SchemaResponse


class DbmlGeneratorService:
    """Generates schema artifacts for the backend schema review flow."""

    def generate_schema(self, request: SchemaGenerationRequest) -> SchemaResponse:
        """Return schema artifacts using the current MVP placeholder implementation."""
        # This method keeps the response contract stable while DBML generation evolves.
        return SchemaResponse(
            projectId=request.projectId,
            schemaName=request.schemaName,
            dbmlContent="Table customers { id int [pk] name varchar }",
            schemaJson={
                "tables": [],
                "relationships": [],
            },
            sqlContent="CREATE TABLE customers (...);",
        )

