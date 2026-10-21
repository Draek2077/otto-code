// Test stand-in for the `cloudflare:workers` virtual module, wired up via the
// alias in vitest.config.ts. Tests mutate `env` directly to shape bindings.
export const env: Record<string, unknown> = {};
