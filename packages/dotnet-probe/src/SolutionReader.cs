using Microsoft.VisualStudio.SolutionPersistence;
using Microsoft.VisualStudio.SolutionPersistence.Model;
using Microsoft.VisualStudio.SolutionPersistence.Serializer;

namespace Otto.DotnetProbe;

/// <summary>
/// Reads a solution through the same serializer MSBuild, the .NET CLI and Visual Studio use, so
/// the tree cannot disagree with <c>dotnet build</c> about what is in the solution.
///
/// One code path serves both formats: <c>GetSerializerByMoniker</c> picks the <c>.sln</c> or
/// <c>.slnx</c> reader from the file name. Solution filters (<c>.slnf</c>) are deliberately not
/// handled - out of scope for Phase 1, and answering for one would be worse than refusing.
/// </summary>
internal static class SolutionReader
{
    public static async Task<SolutionTreeDto> ReadAsync(string solutionPath, CancellationToken cancellationToken)
    {
        string fullPath = Path.GetFullPath(solutionPath);
        if (!File.Exists(fullPath))
        {
            throw new FileNotFoundException($"Solution not found: {PathNormalizer.ToWire(fullPath)}");
        }

        ISolutionSerializer? serializer = SolutionSerializers.GetSerializerByMoniker(fullPath);
        if (serializer is null)
        {
            throw new InvalidOperationException(
                $"Not a solution file this host can read: {PathNormalizer.ToWire(fullPath)}");
        }

        SolutionModel model = await serializer.OpenAsync(fullPath, cancellationToken);
        string directory = Path.GetDirectoryName(fullPath)!;

        var folders = model.SolutionFolders
            .Select(folder => new SolutionFolderDto(folder.Path, folder.Name, folder.Parent?.Path))
            .OrderBy(folder => folder.Path, StringComparer.Ordinal)
            .ToList();

        var projects = model.SolutionProjects
            .Select(project => new SolutionProjectDto(
                project.Id.ToString(),
                project.ActualDisplayName,
                PathNormalizer.ResolveFrom(directory, project.FilePath),
                project.TypeId.ToString(),
                project.Parent?.Path))
            .OrderBy(project => project.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new SolutionTreeDto(
            PathNormalizer.ToWire(fullPath),
            FormatOf(fullPath),
            Path.GetFileNameWithoutExtension(fullPath),
            folders,
            projects,
            model.BuildTypes.ToList(),
            model.Platforms.ToList());
    }

    private static string FormatOf(string path) =>
        Path.GetExtension(path).Equals(".slnx", StringComparison.OrdinalIgnoreCase) ? "slnx" : "sln";
}
