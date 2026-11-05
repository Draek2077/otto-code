using System.Text.Json;

namespace Otto.DotnetProbe;

/// <summary>
/// Dispatch for one line of NDJSON.
///
/// Read-only by construction: there is no mutation method here, and there will not be one until
/// Phase 3. Phase 1 ships a view that cannot corrupt a solution, and the cheapest way to keep that
/// promise honest is for the process that could do the damage to have no verb for it.
///
/// Note what is <b>not</b> here: solution discovery. Answering "does this workspace have a
/// solution" decides whether the switcher appears at all, so it runs on every eligible workspace;
/// spawning a .NET process to glob for <c>*.sln</c> would be the largest single cost in the
/// feature and it would be paid by workspaces that turn out to have no solution. The daemon walks
/// the directory itself (<c>solution-model/dotnet/discover.ts</c>) and only spawns this process
/// once a tree is actually requested.
/// </summary>
internal sealed class RequestHandler
{
    private readonly Lazy<ProjectEvaluator> evaluator = new(() => new ProjectEvaluator());

    public async Task<string> HandleAsync(string line)
    {
        ProbeRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<ProbeRequest>(line, ProbeJson.Options);
        }
        catch (JsonException error)
        {
            return Serialize(ProbeResponse.Failure(null, $"Malformed request: {error.Message}"));
        }

        if (request?.Method is not { Length: > 0 } method)
        {
            return Serialize(ProbeResponse.Failure(request?.Id, "Request has no method"));
        }

        try
        {
            object result = method switch
            {
                "solution.tree" => await SolutionReader.ReadAsync(
                    RequiredString(request.Params, "solutionPath"),
                    CancellationToken.None),
                "project.load" => evaluator.Value.Load(RequiredString(request.Params, "projectPath")),
                "project.invalidate" => Invalidate(request.Params),
                "ping" => new { pong = true },
                _ => throw new InvalidOperationException($"Unknown method: {method}"),
            };
            return Serialize(ProbeResponse.Success(request.Id, result));
        }
        catch (Exception error)
        {
            // One project that fails to evaluate must not blank the tree, so the failure is a
            // per-request answer carrying MSBuild's own message rather than a process-level event.
            return Serialize(ProbeResponse.Failure(request.Id, Describe(error)));
        }
    }

    private object Invalidate(JsonElement? parameters)
    {
        string? projectPath = OptionalString(parameters, "projectPath");
        if (projectPath is null)
        {
            evaluator.Value.InvalidateAll();
        }
        else
        {
            evaluator.Value.Invalidate(projectPath);
        }
        return new { invalidated = true };
    }

    /// <summary>
    /// MSBuild wraps the useful sentence in an <c>InvalidProjectFileException</c> whose own message
    /// is the useful one, but nested evaluation errors arrive as an outer exception with the detail
    /// underneath. Both halves go to the client: this text is what a per-node error renders.
    /// </summary>
    private static string Describe(Exception error)
    {
        return error.InnerException is null
            ? error.Message
            : $"{error.Message}: {error.InnerException.Message}";
    }

    private static string RequiredString(JsonElement? parameters, string name)
    {
        return OptionalString(parameters, name)
            ?? throw new InvalidOperationException($"Missing required parameter: {name}");
    }

    private static string? OptionalString(JsonElement? parameters, string name)
    {
        if (parameters is not { ValueKind: JsonValueKind.Object } element)
        {
            return null;
        }
        if (!element.TryGetProperty(name, out JsonElement value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }
        string? text = value.GetString();
        return string.IsNullOrWhiteSpace(text) ? null : text;
    }

    private static string Serialize(ProbeResponse response) =>
        JsonSerializer.Serialize(response, ProbeJson.Options);
}
