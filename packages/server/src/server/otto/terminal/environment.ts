const SESSION_KEYS = [
  "WORKSPACE_ID",
  "TERMINAL_ID",
  "ACTIVITY_TOKEN",
  "TERMINAL_ACTIVITY_URL",
  "HOOK_CLI",
  "ZSH_ZDOTDIR",
];
/** COMPAT(terminal09Environment): added v0.10.0; remove after 2027-05-02 once user shell integrations no longer consume 0.9 session aliases. */
export function ottoTerminalEnvironment(env: Record<string, string>): Record<string, string> {
  const result = { ...env };
  for (const suffix of SESSION_KEYS) {
    const value = env[`PASEO_${suffix}`];
    const key = `OTTO_${suffix}`;
    // Session identity comes from this PTY, never an inherited parent terminal.
    if (value === undefined) delete result[key];
    else result[key] = value;
  }
  return result;
}
