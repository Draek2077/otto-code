// Fast-Refresh-proof module state for the resource monitor's modules.
//
// These modules hold live machinery in module scope: the census interval, the
// rAF frame loop, the LoAF observer, the patched timer globals. Metro Fast
// Refresh re-evaluates an edited module (and its import parents), which resets
// module-level state to its initial value while the old closure keeps running.
// Measured 2026-08-23: a dev session accumulated stacked census intervals this
// way, and the census - 70-380ms per run against a loaded session - went from
// one run per 10s to roughly one per second, dominating the long-frame profile
// the monitor exists to measure.
//
// Keying the state on `globalThis` under a `Symbol.for` name makes re-evaluation
// reattach to the live instance instead of starting a second one. The trade-off
// is that after a refresh the surviving instance runs the pre-edit code until a
// full reload; for a diagnostic instrument that beats stacking. Production
// bundles evaluate once, so this is inert there.

export function getGlobalSingleton<T>(key: string, create: () => T): T {
  const slots = globalThis as unknown as Record<symbol, T | undefined>;
  const slot = Symbol.for(key);
  return (slots[slot] ??= create());
}
