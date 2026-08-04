namespace Otto.DotnetProbe;

/// <summary>
/// Every path that leaves this process goes through here.
///
/// The solution libraries return platform separators - <c>src\App\App.csproj</c> on Windows even
/// when the <c>.slnx</c> on disk stores forward slashes - so without one boundary the wire shape
/// would differ by OS and every consumer would have to know it. Normalising once here is what
/// lets the daemon and the client treat a path as a plain string.
/// </summary>
internal static class PathNormalizer
{
    /// <summary>Absolute, forward-slashed, with no trailing separator.</summary>
    public static string ToWire(string path)
    {
        string full = Path.GetFullPath(path);
        string normalized = full.Replace('\\', '/');
        // A drive root ("C:/") keeps its slash; anything else loses a trailing one so two spellings
        // of the same directory compare equal.
        return normalized.Length > 1 && normalized.EndsWith('/') && !normalized.EndsWith(":/")
            ? normalized[..^1]
            : normalized;
    }

    /// <summary>
    /// Resolve a path the solution file declared, which is relative to the solution's own
    /// directory and may use either separator regardless of the OS reading it.
    /// </summary>
    public static string ResolveFrom(string baseDirectory, string declaredPath)
    {
        return ToWire(Path.Combine(baseDirectory, declaredPath.Replace('\\', '/')));
    }
}
