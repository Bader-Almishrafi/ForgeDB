namespace ForgeDB.API.Models.DTOs;

[Obsolete("Use ProjectCreateRequestDto. Project ownership now comes only from the authenticated JWT.")]
public class ProjectCreateDto : ProjectCreateRequestDto
{
}
