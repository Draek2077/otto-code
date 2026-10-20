// Otto's product identity: every name, id, path, and URL a user, an operating
// system, an app store, or npm can see. Paseo source keeps its own identifiers;
// the places where Paseo would show its identity read these values instead and
// carry an `OTTO(identity)` marker. See docs/otto-identity.md for the boundary.

export const OTTO_PRODUCT_NAME = "Otto";
export const OTTO_CLI_COMMAND = "otto";

export const OTTO_HOME_DIRECTORY_NAME = ".otto";
export const OTTO_DEFAULT_HOME = `~/${OTTO_HOME_DIRECTORY_NAME}`;

export const OTTO_DEFAULT_DAEMON_PORT = 6868;
export const OTTO_DEFAULT_LISTEN = `127.0.0.1:${OTTO_DEFAULT_DAEMON_PORT}`;

export const OTTO_PROJECT_CONFIG_FILE = "otto.json";
export const OTTO_URL_SCHEME = "otto";

export const OTTO_WEBSITE_URL = "https://otto-code.me";

export const OTTO_REPOSITORY_SLUG = "Draek2077/otto-code";
export const OTTO_REPOSITORY_URL = `https://github.com/${OTTO_REPOSITORY_SLUG}`;
export const OTTO_ISSUES_NEW_URL = `${OTTO_REPOSITORY_URL}/issues/new`;
export const OTTO_RELEASES_URL = `${OTTO_REPOSITORY_URL}/releases`;
export const OTTO_RELEASES_LATEST_URL = `${OTTO_RELEASES_URL}/latest`;
export const OTTO_RELEASE_DOWNLOAD_BASE_URL = `${OTTO_RELEASES_URL}/download`;
export const OTTO_CHANGELOG_RAW_URL = `https://raw.githubusercontent.com/${OTTO_REPOSITORY_SLUG}/main/CHANGELOG.md`;

export const OTTO_NPM_SCOPE = "@otto-code";
export const OTTO_CLI_PACKAGE = `${OTTO_NPM_SCOPE}/cli`;

export const OTTO_DESKTOP_APP_ID = "ai.ottocode.desktop";
export const OTTO_MOBILE_PACKAGE_ID = "me.ottocode.mobile";
export const OTTO_MOBILE_DEBUG_PACKAGE_ID = `${OTTO_MOBILE_PACKAGE_ID}.debug`;

// Otto hosts its own web app; pairing links and CORS defaults point here.
export const OTTO_APP_BASE_URL = "https://app.otto-code.me";

// The daemon's agent-facing MCP server; agents see tools as mcp__otto__<tool>.
export const OTTO_MCP_SERVER_NAME = "otto";
