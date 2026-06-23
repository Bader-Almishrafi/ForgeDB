from models.analysis_request import AnalysisRequest
from models.analysis_response import ColumnProfile, DatasetProfile, ProfileAnalysisResponse


class DataProfilerService:
    def profile_datasets(self, request: AnalysisRequest) -> ProfileAnalysisResponse:
        return ProfileAnalysisResponse(
            projectId=request.projectId,
            datasets=[
                DatasetProfile(
                    datasetId=1,
                    tableName="customers",
                    rowCount=1,
                    columnCount=3,
                    missingValuesCount=0,
                    duplicateRowsCount=0,
                    columns=[
                        ColumnProfile(
                            columnName="id",
                            detectedDataType="integer",
                            missingValuesCount=0,
                            uniqueValuesCount=1,
                            isNullable=False,
                            sampleValues=[1],
                        )
                    ],
                )
            ],
        )

