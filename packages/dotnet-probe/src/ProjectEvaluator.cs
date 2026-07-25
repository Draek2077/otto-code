using Microsoft.Build.Evaluation;

namespace Otto.DotnetProbe;

/// <summary>
/// Per-project MSBuild <b>evaluation</b> against one warm <see cref="ProjectCollection"/>.
///
/// Evaluation, not a design-time build, is the whole decision here (Phase 0's remaining spike,
/// measured on a 12-project solution): a warm collection pays SDK resolution and the import graph
/// once — 227 ms for the first project, ~33 ms for each one after — where Buildalyzer's
/// design-time build cost ~1.4 s per project, 19.3 s for the same twelve, on a 31 MB payload that
/// also raises the runtime floor to .NET 9. Evaluation is additionally the <i>more correct</i>
/// answer for a file tree: a design-time build reports generated <c>obj/*.AssemblyInfo.cs</c> as
/// sources, because it models a compilation, and this view models an organisation.
///
/// Every MSBuild type in the process is reached through this class, so nothing loads MSBuild's
/// assemblies before <c>MSBuildLocator</c> has pointed the runtime at the installed SDK.
/// </summary>
internal sealed class ProjectEvaluator : IDisposable
{
    /// <summary>
    /// Item types worth reporting. Not "everything": an evaluated project carries hundreds of
    /// internal item types (<c>_CoreCompileResourceInputs</c>, every resolved reference, every
    /// intermediate), and shipping them would make a project's payload orders of magnitude larger
    /// than the tree that renders it. These are the ones a developer would recognise as "files in
    /// the project".
    /// </summary>
    private static readonly string[] ReportedItemTypes =
    [
        "Compile",
        "Content",
        "None",
        "EmbeddedResource",
        "AdditionalFiles",
        "Page",
        "ApplicationDefinition",
        "Resource",
    ];

    private readonly ProjectCollection collection = new();

    public ProjectContentsDto Load(string projectPath)
    {
        string fullPath = Path.GetFullPath(projectPath);
        if (!File.Exists(fullPath))
        {
            throw new FileNotFoundException($"Project not found: {PathNormalizer.ToWire(fullPath)}");
        }

        string directory = Path.GetDirectoryName(fullPath)!;
        Project project = LoadOrReuse(fullPath);

        var items = new Dictionary<string, IReadOnlyList<ProjectItemDto>>(StringComparer.Ordinal);
        foreach (string itemType in ReportedItemTypes)
        {
            List<ProjectItemDto> entries = project
                .GetItems(itemType)
                .Select(item => new ProjectItemDto(
                    PathNormalizer.ResolveFrom(directory, item.EvaluatedInclude),
                    IsImplicit(item, fullPath)))
                .ToList();
            if (entries.Count > 0)
            {
                items[itemType] = entries;
            }
        }

        var projectReferences = project
            .GetItems("ProjectReference")
            .Select(item => PathNormalizer.ResolveFrom(directory, item.EvaluatedInclude))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var packageReferences = project
            .GetItems("PackageReference")
            .Select(item => new PackageReferenceDto(item.EvaluatedInclude, NullIfEmpty(item.GetMetadataValue("Version"))))
            .ToList();

        return new ProjectContentsDto(
            PathNormalizer.ToWire(fullPath),
            items,
            projectReferences,
            packageReferences,
            TargetFrameworksOf(project),
            NullIfEmpty(project.GetPropertyValue("OutputType")),
            // Set by the SDK's own props, so it is the toolchain's answer to "is this SDK-style",
            // not our guess from the presence of an attribute.
            string.Equals(project.GetPropertyValue("UsingMicrosoftNETSdk"), "true", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Drop one project's evaluation so the next request re-reads it. Called when the watcher sees
    /// the project — or something it imports — change; keeping the stale evaluation would make the
    /// tree quietly wrong, which is worse than making it slow.
    /// </summary>
    public void Invalidate(string projectPath)
    {
        string fullPath = Path.GetFullPath(projectPath);
        foreach (Project loaded in collection.GetLoadedProjects(fullPath).ToList())
        {
            collection.UnloadProject(loaded);
        }
    }

    /// <summary>
    /// Drop everything. The import graph is the expensive part of a warm collection and it is
    /// shared, so a solution-level change invalidates all of it rather than project by project.
    /// </summary>
    public void InvalidateAll()
    {
        collection.UnloadAllProjects();
    }

    private Project LoadOrReuse(string fullPath)
    {
        Project? existing = collection.GetLoadedProjects(fullPath).FirstOrDefault();
        return existing ?? collection.LoadProject(fullPath);
    }

    /// <summary>
    /// True when something other than this project file declared the item — an SDK default glob,
    /// or a <c>Directory.Build.props</c>. Phase 2 turns on exactly this: for an implicit item,
    /// creating the file already adds it to the project and no <c>.csproj</c> edit exists to make.
    /// </summary>
    private static bool IsImplicit(ProjectItem item, string projectPath)
    {
        string? definedIn = item.Xml?.ContainingProject?.FullPath;
        return definedIn is null || !string.Equals(
            Path.GetFullPath(definedIn),
            projectPath,
            StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Multi-targeting first: an outer build sets <c>TargetFrameworks</c> and leaves
    /// <c>TargetFramework</c> empty, so reading the singular property alone reports a
    /// multi-targeted project as having no framework at all.
    /// </summary>
    private static IReadOnlyList<string> TargetFrameworksOf(Project project)
    {
        string plural = project.GetPropertyValue("TargetFrameworks");
        if (!string.IsNullOrWhiteSpace(plural))
        {
            return plural
                .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToList();
        }

        string single = project.GetPropertyValue("TargetFramework");
        return string.IsNullOrWhiteSpace(single) ? [] : [single];
    }

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

    public void Dispose()
    {
        collection.UnloadAllProjects();
        collection.Dispose();
    }
}
