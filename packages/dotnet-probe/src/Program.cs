using System.Text.Json;
using Microsoft.Build.Locator;

namespace Otto.DotnetProbe;

/// <summary>
/// The only thing in Otto that knows what a <c>.csproj</c> is.
///
/// Speaks newline-delimited JSON on stdin/stdout, one request per line, one response per line.
/// The daemon owns the lifecycle (lazy spawn, idle reap, cap, crash backoff); this process owns
/// nothing but a warm <c>ProjectCollection</c> and the domain knowledge Microsoft's own libraries
/// supply.
///
/// Two invariants that the daemon relies on and that are cheap to break by accident:
///
/// 1. <b>MSBuild is registered before any MSBuild type is touched.</b> <c>MSBuildLocator</c>
///    resolves assemblies from the installed SDK, and the CLR loads a type's assembly when it
///    first JITs a method that mentions it. Everything MSBuild-shaped therefore lives behind
///    <see cref="ProjectEvaluator"/>, which is only referenced after registration succeeds.
/// 2. <b>Every path on the wire is absolute and forward-slashed.</b> The library returns
///    platform separators (<c>src\App\App.csproj</c> on Windows) even for a <c>.slnx</c> that
///    stores forward slashes, so normalising here is what makes the wire shape identical on
///    every OS. Relative-to-the-workspace is the daemon's business; this process has never
///    heard of a workspace.
/// </summary>
internal static class Program
{
    /// <summary>
    /// Bumped when the request or response shape changes in a way an older daemon could
    /// misread. The daemon refuses a payload whose major version it does not know rather than
    /// guessing — a stale payload on disk is the expected failure, not an exotic one.
    /// </summary>
    private const int ProtocolVersion = 1;

    private static async Task<int> Main()
    {
        VisualStudioInstance instance;
        try
        {
            // Highest available, so a repo pinned by global.json still resolves through the SDK
            // rather than through whatever we happened to compile against.
            instance = MSBuildLocator.RegisterDefaults();
        }
        catch (Exception error)
        {
            // Structure alone needs only the runtime, but per-project evaluation needs the SDK,
            // and a half-tree is worse than no switcher. Report and exit; the daemon reads this
            // as "this host cannot supply the feature".
            await Console.Error.WriteLineAsync($"otto-dotnet-probe: no .NET SDK found: {error.Message}");
            return 2;
        }

        Console.OutputEncoding = System.Text.Encoding.UTF8;
        await WriteLineAsync(
            JsonSerializer.Serialize(
                new HandshakeMessage(ProtocolVersion, instance.Version.ToString(), instance.MSBuildPath),
                ProbeJson.Options));

        var handler = new RequestHandler();

        while (await Console.In.ReadLineAsync() is { } line)
        {
            if (line.Length == 0)
            {
                continue;
            }

            string response;
            try
            {
                response = await handler.HandleAsync(line);
            }
            catch (Exception error)
            {
                // A malformed line must not take the process down: the daemon would read the exit
                // as a crash and back off, punishing every later request for one bad frame.
                response = JsonSerializer.Serialize(
                    ProbeResponse.Failure(null, error.Message),
                    ProbeJson.Options);
            }

            await WriteLineAsync(response);
        }

        return 0;
    }

    /// <summary>
    /// One frame, flushed. Without the flush a response can sit in the buffer while the daemon
    /// waits on it, which reads as a hung sidecar rather than a slow one.
    /// </summary>
    private static async Task WriteLineAsync(string payload)
    {
        await Console.Out.WriteLineAsync(payload);
        await Console.Out.FlushAsync();
    }
}
