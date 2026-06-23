using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DatasetsController : ControllerBase
{
    private readonly IDatasetImportService _datasetImportService;

    public DatasetsController(IDatasetImportService datasetImportService)
    {
        _datasetImportService = datasetImportService;
    }

    [HttpPost("upload")]
    public async Task<ActionResult<DatasetResponseDto>> Upload([FromForm] DatasetUploadDto request, CancellationToken cancellationToken)
    {
        return Ok(await _datasetImportService.ImportDatasetAsync(request, cancellationToken));
    }

    [HttpGet("project/{projectId:int}")]
    public async Task<ActionResult<IEnumerable<DatasetResponseDto>>> GetByProject(int projectId, CancellationToken cancellationToken)
    {
        return Ok(await _datasetImportService.GetProjectDatasetsAsync(projectId, cancellationToken));
    }
}
