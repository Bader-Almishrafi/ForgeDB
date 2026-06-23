using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("api")]
public class DatasetsController : ControllerBase
{
    private readonly IDatasetImportService _datasetImportService;
    private readonly IDashboardService _dashboardService;

    public DatasetsController(IDatasetImportService datasetImportService, IDashboardService dashboardService)
    {
        _datasetImportService = datasetImportService;
        _dashboardService = dashboardService;
    }

    [HttpPost("projects/{projectId:int}/datasets/upload")]
    public async Task<ActionResult<DatasetResponseDto>> Upload(int projectId, [FromForm] DatasetUploadDto request, CancellationToken cancellationToken)
    {
        return Ok(await _datasetImportService.UploadDatasetAsync(projectId, request, cancellationToken));
    }

    [HttpGet("projects/{projectId:int}/datasets")]
    public async Task<ActionResult<IEnumerable<DatasetResponseDto>>> GetByProject(int projectId, CancellationToken cancellationToken)
    {
        return Ok(await _datasetImportService.GetProjectDatasetsAsync(projectId, cancellationToken));
    }

    [HttpGet("datasets/{datasetId:int}/preview")]
    public async Task<ActionResult<DatasetPreviewDto>> GetPreview(int datasetId, CancellationToken cancellationToken)
    {
        return Ok(await _datasetImportService.GetDatasetPreviewAsync(datasetId, cancellationToken));
    }

    [HttpPost("datasets/{datasetId:int}/analyze")]
    public async Task<ActionResult<DatasetAnalysisResponseDto>> Analyze(int datasetId, DatasetAnalysisRequestDto request, CancellationToken cancellationToken)
    {
        return Ok(await _datasetImportService.AnalyzeDatasetAsync(datasetId, request, cancellationToken));
    }

    [HttpGet("datasets/{datasetId:int}/dashboard")]
    public async Task<ActionResult<DashboardResponseDto>> GetDashboard(int datasetId, CancellationToken cancellationToken)
    {
        return Ok(await _dashboardService.GetDatasetDashboardAsync(datasetId, cancellationToken));
    }
}
