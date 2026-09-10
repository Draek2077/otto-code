import { z } from "zod";
import type {
  ForgeConnection,
  ForgeConnectionsAction,
} from "@otto-code/protocol/forge-connections";
import { parseGitRemoteLocation, isGitHubHost } from "@otto-code/protocol/git-remote";
import { execCommand } from "../../utils/spawn.js";
import { findExecutable } from "../../executable-resolution/executable-resolution.js";
import { resolveSshHostname } from "../../utils/ssh-hostname.js";
import { defaultResolveRemoteUrl } from "../forge-cli-command.js";
import { createGitHubHostingService } from "./github-hosting-service.js";
import { createBitbucketCloudService } from "./bitbucket-cloud-service.js";
import { createGitLabService } from "../gitlab-service.js";
import { createGiteaService } from "../gitea-service.js";
import type { ForgeService } from "../forge-service.js";
import type { ConnectionCredential } from "./connection-store.js";
import { createGitHostingForgeAdapter } from "./router.js";
import { BITBUCKET_CLOUD_CAPABILITIES, type GitHostingService } from "./types.js";

const CLOUD_HOSTS: Record<string, string> = {
  github: "github.com",
  "bitbucket-cloud": "bitbucket.org",
  gitlab: "gitlab.com",
  codeberg: "codeberg.org",
};
export function defaultForgeConnectionHost(forge: string): string | null {
  return CLOUD_HOSTS[forge] ?? null;
}

export async function resolveForgeConnectionRemote(
  cwd: string,
): Promise<{ host: string; url: string } | null> {
  const remote = await defaultResolveRemoteUrl(cwd);
  const parsed = remote && parseGitRemoteLocation(remote);
  if (!parsed) return null;
  const resolvedHost =
    parsed.transport === "scp" || parsed.transport === "ssh"
      ? ((await resolveSshHostname(parsed.host)) ?? parsed.host)
      : parsed.host;
  let host = resolvedHost;
  if (isGitHubHost(host)) host = "github.com";
  if (host === "altssh.bitbucket.org") host = "bitbucket.org";
  // An SSH port belongs to Git transport, not the forge's HTTPS endpoint.
  const apiHost = parsed.transport === "https" && parsed.port ? `${host}:${parsed.port}` : host;
  return { host: apiHost, url: `https://${apiHost}/${parsed.path}` };
}

async function runCli(
  binary: string,
  args: string[],
  cwd: string,
  envOverlay: Record<string, string>,
) {
  const executable = await findExecutable(binary);
  if (!executable) throw new Error(`Install ${binary} on this host to use this connection.`);
  return execCommand(executable, args, {
    cwd,
    envOverlay,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

const AccountSchema = z.object({
  login: z.string().optional(),
  username: z.string().optional(),
  uuid: z.string().optional(),
});

function parseAccountData<T>(text: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new Error("The Git server or CLI returned invalid account information.");
  }
}

async function verifyToken(
  forge: string,
  host: string,
  secret: string,
  account?: string,
): Promise<string> {
  let url = "https://api.bitbucket.org/2.0/user";
  if (forge === "github")
    url = host === "github.com" ? "https://api.github.com/user" : `https://${host}/api/v3/user`;
  if (forge === "gitlab") url = `https://${host}/api/v4/user`;
  const authorization =
    forge === "bitbucket-cloud"
      ? `Basic ${Buffer.from(`${account}:${secret}`).toString("base64")}`
      : `Bearer ${secret}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: authorization, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Could not reach the Git server. Check the server address and try again.");
  }
  if (!response.ok)
    throw new Error(
      `The Git server rejected this credential (HTTP ${response.status}). Check its account and permissions.`,
    );
  const user = parseAccountData(await response.text(), AccountSchema);
  const identity = user.login ?? user.username ?? user.uuid;
  if (!identity || identity.includes(secret))
    throw new Error("The Git server did not identify this account.");
  return identity;
}

/** Credential entry and CLI imports are user-initiated; nothing here runs from polling. */
export async function validateForgeConnection(
  input: Extract<ForgeConnectionsAction, { kind: "save" }>,
  cwd: string,
): Promise<ConnectionCredential> {
  if (["gitea", "forgejo", "codeberg"].includes(input.forge)) {
    return validateTeaConnection(input, cwd);
  }
  if (!["github", "gitlab", "bitbucket-cloud"].includes(input.forge))
    throw new Error("This forge does not support saved connections yet.");
  if (input.forge === "bitbucket-cloud" && input.host !== "bitbucket.org")
    throw new Error("Bitbucket Cloud connections must use bitbucket.org.");
  let token = input.secret?.trim();
  if (input.method === "cli" && input.forge === "github") {
    if (!input.account?.trim()) throw new Error("Enter the GitHub login to import.");
    try {
      const result = await runCli(
        "gh",
        ["auth", "token", "--hostname", input.host, "--user", input.account.trim()],
        cwd,
        {
          GH_TOKEN: "",
          GITHUB_TOKEN: "",
          GH_ENTERPRISE_TOKEN: "",
          GITHUB_ENTERPRISE_TOKEN: "",
          GH_PROMPT_DISABLED: "1",
        },
      );
      token = result.stdout.trim();
    } catch {
      throw new Error(
        "That GitHub login is not available on this host. Connect it or enter an API token.",
      );
    }
  } else if (input.method !== "token") throw new Error("Choose a supported credential method.");
  if (!token) throw new Error("Enter a credential for this connection.");
  if (input.forge === "bitbucket-cloud" && !input.account?.trim())
    throw new Error("Enter the Atlassian account email.");
  const identity = await verifyToken(input.forge, input.host, token, input.account?.trim());
  if (input.method === "cli" && identity.toLowerCase() !== input.account!.trim().toLowerCase())
    throw new Error("The saved credential belongs to a different account.");
  return {
    account: identity,
    secret:
      input.forge === "bitbucket-cloud"
        ? JSON.stringify({ email: input.account!.trim(), apiToken: token })
        : token,
  };
}

async function checkTeaLogin(login: string, host: string, cwd: string): Promise<void> {
  const { stdout } = await runCli("tea", ["login", "list", "-o", "json"], cwd, {
    GIT_TERMINAL_PROMPT: "0",
  });
  const logins = parseAccountData(stdout, z.array(z.object({ name: z.string(), url: z.string() })));
  const selected = logins.find((entry) => entry.name === login);
  if (!selected || new URL(selected.url).origin !== `https://${host}`)
    throw new Error("That saved tea login does not match this Git server.");
}

async function readTeaAccount(login: string, cwd: string): Promise<string> {
  const { stdout } = await runCli("tea", ["api", "--login", login, "user"], cwd, {
    GIT_TERMINAL_PROMPT: "0",
  });
  return parseAccountData(stdout, z.object({ login: z.string().min(1) })).login;
}

async function validateTeaConnection(
  input: Extract<ForgeConnectionsAction, { kind: "save" }>,
  cwd: string,
): Promise<ConnectionCredential> {
  if (input.method !== "cli" || !input.account?.trim())
    throw new Error("Select a saved tea login for this connection.");
  const login = input.account.trim();
  await checkTeaLogin(login, input.host, cwd);
  return { account: await readTeaAccount(login, cwd), secret: login };
}

/** Each returned adapter owns caches and polling for exactly one connection. */
export function createConnectedForgeService(
  connection: ForgeConnection,
  readCredential: () => Promise<string>,
): ForgeService {
  const resolveRemoteUrl = async (cwd: string) => {
    const remote = await resolveForgeConnectionRemote(cwd);
    if (remote && remote.host !== connection.host)
      throw new Error(
        "The repository now uses a different Git server. Select its connection again.",
      );
    return remote?.url ?? null;
  };
  const runner =
    (binary: string) =>
    async (args: string[], options: { cwd: string; envOverlay?: Record<string, string> }) => {
      const remote = await resolveRemoteUrl(options.cwd);
      const secret = await readCredential();
      const env = { ...options.envOverlay, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" };
      try {
        if (binary === "gh") {
          return await runCli(binary, args, options.cwd, {
            ...env,
            GH_HOST: connection.host,
            GH_REPO: remote ? `${connection.host}/${parseGitRemoteLocation(remote)!.path}` : "",
            GH_TOKEN: secret,
            GITHUB_TOKEN: "",
            GH_ENTERPRISE_TOKEN: secret,
            GITHUB_ENTERPRISE_TOKEN: "",
            GH_DEBUG: "",
            DEBUG: "",
          });
        }
        if (binary === "glab") {
          return await runCli(binary, args, options.cwd, {
            ...env,
            GITLAB_HOST: connection.host,
            GITLAB_TOKEN: secret,
            GITLAB_ACCESS_TOKEN: "",
            OAUTH_TOKEN: "",
            GLAB_ENABLE_CI_AUTOLOGIN: "false",
            GITLAB_CI: "false",
            GLAB_DEBUG: "",
          });
        }
        await checkTeaLogin(secret, connection.host, options.cwd);
        if ((await readTeaAccount(secret, options.cwd)) !== connection.account)
          throw new Error("The saved tea login changed accounts. Reconnect it in Git connections.");
        return await runCli(binary, [...args, "--login", secret], options.cwd, env);
      } catch (error) {
        // Command errors may include raw output; never allow a credential into their diagnostics.
        const failure = error as { stderr?: string; code?: number; killed?: boolean };
        throw Object.assign(new Error("Git connection command failed."), {
          stderr: String(failure.stderr ?? "Git connection command failed.")
            .split(secret)
            .join("[REDACTED]"),
          code: failure.code,
          killed: failure.killed,
        });
      }
    };
  if (connection.forge === "github")
    return createGitHubHostingService({
      runner: runner("gh"),
      resolveRepoHost: async () => connection.host,
    });
  if (connection.forge === "gitlab")
    return createGitLabService({ runner: runner("glab"), resolveRemoteUrl });
  if (["gitea", "forgejo", "codeberg"].includes(connection.forge)) {
    const service = createGiteaService({ runner: runner("tea"), resolveRemoteUrl });
    service.isAuthenticated = async ({ cwd }) => {
      await runner("tea")(["api", "user"], { cwd });
      return true;
    };
    return service;
  }
  // Bitbucket's adapter expects a fixed credential pair; lazy construction keeps
  // secret reads in the daemon while preserving its native REST implementation.
  let pending: Promise<GitHostingService> | null = null;
  const load = () =>
    (pending ??= readCredential()
      .then((value) =>
        createBitbucketCloudService({
          credentials: z
            .object({ email: z.string(), apiToken: z.string() })
            .parse(JSON.parse(value)),
          resolveRemoteUrl,
        }),
      )
      .catch((error) => {
        pending = null;
        throw error;
      }));
  const adapter = createGitHostingForgeAdapter({
    serviceFor: async () => {
      await readCredential();
      return load();
    },
    invalidate: (cwd) => {
      void pending?.then((s) => s.invalidate({ cwd })).catch(() => {});
    },
    dispose: () => {
      void pending?.then((s) => s.dispose?.()).catch(() => {});
    },
  });
  return Object.assign(adapter, {
    providerId: "bitbucket-cloud" as const,
    capabilities: BITBUCKET_CLOUD_CAPABILITIES,
    listRepositories: async (
      input: Parameters<NonNullable<GitHostingService["listRepositories"]>>[0],
    ) => {
      await readCredential();
      return (await load()).listRepositories!(input);
    },
    listOwners: async () => {
      await readCredential();
      return (await load()).listOwners!();
    },
    createRepository: async (
      input: Parameters<NonNullable<GitHostingService["createRepository"]>>[0],
    ) => {
      await readCredential();
      return (await load()).createRepository!(input);
    },
  });
}
