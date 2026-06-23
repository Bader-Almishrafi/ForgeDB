from models.analysis_request import SchemaGenerationRequest
from models.schema_response import SchemaResponse


class DbmlGeneratorService:
    def generate_schema(self, request: SchemaGenerationRequest) -> SchemaResponse:
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

