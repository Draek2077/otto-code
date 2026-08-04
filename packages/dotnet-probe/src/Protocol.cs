using System.Text.Json;
using System.Text.Json.Serialization;

namespace Otto.DotnetProbe;

/// <summary>
/// The wire shapes. Deliberately anaemic records: the daemon re-validates everything it reads
/// from this process with zod, so nothing here should try to be clever about defaults.
/// </summary>
internal static class ProbeJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        // Newline-delimited framing: an indented payload would split one frame across many lines.
        WriteIndented = false,
    };
}

internal sealed record HandshakeMessage(int ProtocolVersion, string SdkVersion, string MsbuildPath)
{
    public bool Ready => true;
}

internal sealed record ProbeRequest(string? Id, string? Method, JsonElement? Params);

internal sealed record ProbeError(string Message);

internal sealed record ProbeResponse(string? Id, bool Ok, object? Result, ProbeError? Error)
{
    public static ProbeResponse Success(string? id, object result) => new(id, true, result, null);

    public static ProbeResponse Failure(string? id, string message) =>
        new(id, false, null, new ProbeError(message));
}

// ---- solution.tree -------------------------------------------------------------------------

/// <summary>
/// A solution folder. Virtual - it has a path inside the solution (<c>/Src/</c>) and no
/// filesystem location, which is exactly why no CLI surface can report it and why hand-parsing
/// <c>GlobalSection(NestedProjects)</c> was the wrong plan.
/// </summary>
internal sealed record SolutionFolderDto(string Path, string Name, string? ParentPath);

/// <summary>
/// One project in the solution. <c>Path</c> is absolute and forward-slashed, and may sit outside
/// the workspace - that is the user's arrangement, not ours to police.
/// </summary>
internal sealed record SolutionProjectDto(
    string Id,
    string Name,
    string Path,
    string? TypeId,
    string? FolderPath);

internal sealed record SolutionTreeDto(
    string SolutionPath,
    string Format,
    string Name,
    IReadOnlyList<SolutionFolderDto> Folders,
    IReadOnlyList<SolutionProjectDto> Projects,
    IReadOnlyList<string> BuildTypes,
    IReadOnlyList<string> Platforms);

// ---- project.load --------------------------------------------------------------------------

/// <summary>
/// One evaluated item.
///
/// <c>IsImplicit</c> is the distinction Phase 2 turns on, and it is free to collect here: an item
/// the SDK's default globs contributed is one that "creating the file" already adds, while an
/// item the project file itself declares needs a real <c>.csproj</c> edit. Recording it now costs
/// a string comparison; deriving it later would cost a second evaluation.
/// </summary>
internal sealed record ProjectItemDto(string Path, bool IsImplicit);

internal sealed record PackageReferenceDto(string Name, string? Version);

internal sealed record ProjectContentsDto(
    string ProjectPath,
    IReadOnlyDictionary<string, IReadOnlyList<ProjectItemDto>> Items,
    IReadOnlyList<string> ProjectReferences,
    IReadOnlyList<PackageReferenceDto> PackageReferences,
    IReadOnlyList<string> TargetFrameworks,
    string? OutputType,
    bool IsSdkStyle);
