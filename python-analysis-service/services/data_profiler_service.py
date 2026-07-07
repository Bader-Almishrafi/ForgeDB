from models.analysis_request import AnalysisRequest
from models.analysis_response import ColumnProfile, DatasetProfile, ProfileAnalysisResponse
from services.analysis_service import AnalysisService


class DataProfilerService:
    def profile_datasets(self, request: AnalysisRequest) -> ProfileAnalysisResponse:
        analysis_service = AnalysisService()
        profiles: list[DatasetProfile] = []

        for dataset in request.datasets:
            analysis = analysis_service.analyze(dataset.to_analyze_request())
            profiles.append(
                DatasetProfile(
                    datasetId=analysis.datasetId,
                    tableName=analysis.tableName,
                    rowCount=analysis.rowCount,
                    columnCount=analysis.columnCount,
                    missingValuesCount=analysis.missingValuesCount,
                    duplicateRowsCount=analysis.duplicateRowsCount,
                    columns=[
                        ColumnProfile(
                            columnName=column.name,
                            detectedDataType=column.detectedType,
                            missingValuesCount=column.missingCount,
                            uniqueValuesCount=column.uniqueCount,
                            isNullable=column.missingCount > 0,
                            sampleValues=column.sampleValues,
                        )
                        for column in analysis.columns
                    ],
                )
            )

        return ProfileAnalysisResponse(
            projectId=request.projectId,
            datasets=profiles,
        )

