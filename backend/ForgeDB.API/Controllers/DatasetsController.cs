using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Importing;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Authorize]
[Route("api")]
public class DatasetsController : ControllerBase
{
    private const long MaximumImportRequestBytes = 10 * 1024 * 1024;
    private readonly IDatasetImportService _datasetImportService;
    private readonly IDashboardService _dashboardService;
    private readonly IProjectRepository _projectRepository;
    private readonly IDatasetRepository _datasetRepository;

    public DatasetsController(
        IDatasetImportService datasetImportService,
        IDashboardService dashboardService,
        IProjectRepository projectRepository,
        IDatasetRepository datasetRepository)
    {
        _datasetImportService = datasetImportService;
        _dashboardService = dashboardService;
        _projectRepository = projectRepository;
        _datasetRepository = datasetRepository;
    }

    [HttpPost("datasets/excel/preview")]
    [RequestSizeLimit(MaximumImportRequestBytes)]
    public async Task<ActionResult<ExcelWorkbookPreviewDto>> PreviewExcel(
        [FromForm] ExcelPreviewRequestDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _datasetImportService.PreviewExcelAsync(request, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    [HttpPost("datasets/api/test")]
    public async Task<ActionResult<ApiConnectionTestDto>> TestApiConnection(
        ApiJsonImportRequestDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _datasetImportService.TestApiConnectionAsync(request, cancellationToken));
        }
        catch (ApiImportException exception)
        {
            return ApiImportError(exception);
        }
    }

    [HttpPost("datasets/api/preview")]
    public async Task<ActionResult<ApiJsonPreviewDto>> PreviewApi(
        ApiJsonImportRequestDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _datasetImportService.PreviewApiAsync(request, cancellationToken));
        }
        catch (ApiImportException exception)
        {
            return ApiImportError(exception);
        }
    }

    [HttpPost("projects/{projectId:int}/datasets/api")]
    public async Task<ActionResult<DatasetResponseDto>> ImportApi(
        int projectId,
        ApiJsonImportRequestDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            await EnsureProjectOwnedAsync(projectId, cancellationToken);
            var dataset = await _datasetImportService.ImportApiAsync(projectId, request, cancellationToken);
            return CreatedAtAction(nameof(GetPreview), new { datasetId = dataset.Id }, dataset);
        }
        catch (ApiImportException exception)
        {
            return ApiImportError(exception);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { code = "validation_error", message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { code = "forbidden", message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { code = "not_found", message = exception.Message });
        }
    }

    [HttpPost("projects/{projectId:int}/datasets/upload")]
    [RequestSizeLimit(MaximumImportRequestBytes)]
    public async Task<ActionResult<DatasetResponseDto>> Upload(int projectId, [FromForm] DatasetUploadDto request, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureProjectOwnedAsync(projectId, cancellationToken);
            var dataset = await _datasetImportService.UploadDatasetAsync(projectId, request, cancellationToken);
            return CreatedAtAction(nameof(GetPreview), new { datasetId = dataset.Id }, dataset);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpPost("datasets/{datasetId:int}/replace")]
    [RequestSizeLimit(MaximumImportRequestBytes)]
    public async Task<ActionResult<DatasetResponseDto>> Replace(int datasetId, [FromForm] DatasetUploadDto request, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureDatasetOwnedAsync(datasetId, cancellationToken);
            var dataset = await _datasetImportService.ReplaceDatasetAsync(datasetId, request, cancellationToken);
            return dataset is null ? NotFound(new { message = "Dataset not found." }) : Ok(dataset);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
    }

    [HttpDelete("datasets/{datasetId:int}")]
    public async Task<IActionResult> Delete(int datasetId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureDatasetOwnedAsync(datasetId, cancellationToken);
            var deleted = await _datasetImportService.DeleteDatasetAsync(datasetId, cancellationToken);
            return deleted ? NoContent() : NotFound(new { message = "Dataset not found." });
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
    }

    [HttpGet("projects/{projectId:int}/datasets")]
    public async Task<ActionResult<IEnumerable<DatasetResponseDto>>> GetByProject(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureProjectOwnedAsync(projectId, cancellationToken);
            return Ok(await _datasetImportService.GetProjectDatasetsAsync(projectId, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpGet("datasets/{datasetId:int}/preview")]
    public async Task<ActionResult<DatasetPreviewDto>> GetPreview(int datasetId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureDatasetOwnedAsync(datasetId, cancellationToken);
            return Ok(await _datasetImportService.GetDatasetPreviewAsync(datasetId, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpPost("datasets/{datasetId:int}/analyze")]
    public async Task<ActionResult<DatasetAnalysisResponseDto>> Analyze(int datasetId, DatasetAnalysisRequestDto request, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureDatasetOwnedAsync(datasetId, cancellationToken);
            return Ok(await _datasetImportService.AnalyzeDatasetAsync(datasetId, request, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpGet("datasets/{datasetId:int}/analysis")]
    public async Task<ActionResult<DatasetAnalysisResponseDto>> GetAnalysis(int datasetId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureDatasetOwnedAsync(datasetId, cancellationToken);
            return Ok(await _datasetImportService.GetDatasetAnalysisAsync(datasetId, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpGet("datasets/{datasetId:int}/profile")]
    public Task<ActionResult<DatasetAnalysisResponseDto>> GetProfile(int datasetId, CancellationToken cancellationToken)
    {
        return GetAnalysis(datasetId, cancellationToken);
    }

    [HttpGet("datasets/{datasetId:int}/dashboard")]
    public async Task<ActionResult<DashboardResponseDto>> GetDashboard(int datasetId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureDatasetOwnedAsync(datasetId, cancellationToken);
            return Ok(await _dashboardService.GetDatasetDashboardAsync(datasetId, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    private int GetUserId()
    {
        var value = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        return int.TryParse(value, out var userId) && userId > 0
            ? userId
            : throw new UnauthorizedAccessException("The authentication token does not contain a valid user identifier.");
    }

    private ObjectResult ApiImportError(ApiImportException exception) =>
        StatusCode(exception.StatusCode, new { code = exception.Code, message = exception.Message });

    private async Task EnsureProjectOwnedAsync(int projectId, CancellationToken cancellationToken)
    {
        if (projectId <= 0) throw new ArgumentException("ProjectId must be greater than zero.");
        var project = await _projectRepository.GetByIdAsync(projectId, cancellationToken);
        if (project is not null && project.UserId != GetUserId())
        {
            throw new UnauthorizedAccessException("The project does not belong to the authenticated user.");
        }
    }

    private async Task EnsureDatasetOwnedAsync(int datasetId, CancellationToken cancellationToken)
    {
        var dataset = await _datasetRepository.GetByIdAsync(datasetId, cancellationToken);
        if (dataset is null) return;
        var project = await _projectRepository.GetByIdAsync(dataset.ProjectId, cancellationToken);
        if (project is not null && project.UserId != GetUserId())
        {
            throw new UnauthorizedAccessException("The dataset does not belong to the authenticated user.");
        }
    }
}
