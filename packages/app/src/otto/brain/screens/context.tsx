import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useBrainSurfaceActive } from "../lifecycle";
import type {
  BrainDemand,
  BrainResourceKey,
  BrainScreenPort,
  BrainScreenSnapshot,
} from "./contracts/port";
const PortContext = createContext<BrainScreenPort | null>(null);
export function BrainScreensProvider({
  port,
  children,
}: {
  port: BrainScreenPort;
  children: ReactNode;
}) {
  return <PortContext value={port}>{children}</PortContext>;
}
export function useBrainScreenPort(): BrainScreenPort {
  const port = useContext(PortContext);
  if (!port) throw new Error("BrainScreensProvider is required for Brain operational surfaces.");
  return port;
}
const inactiveSubscribe = () => () => {};
export function useBrainSelection<Key extends keyof BrainScreenSnapshot>(
  key: Key,
): BrainScreenSnapshot[Key] {
  const port = useBrainScreenPort();
  const active = useBrainSurfaceActive();
  const getSnapshot = useCallback(() => port.getSnapshot()[key], [key, port]);
  return useSyncExternalStore(
    active ? port.subscribe : inactiveSubscribe,
    getSnapshot,
    getSnapshot,
  );
}
export function useBrainDemand(demand: BrainDemand, enabled = true): void {
  const port = useBrainScreenPort();
  const active = useBrainSurfaceActive();
  useEffect(() => {
    if (active && enabled) return port.retain(demand);
  }, [active, demand, enabled, port]);
}
export function useBrainView<Key extends BrainResourceKey>(
  key: Key,
  enabled = true,
): BrainScreenSnapshot[Key] {
  useBrainDemand(key, enabled);
  return useBrainSelection(key);
}
export function useBrainOperations() {
  return useBrainScreenPort().operations;
}
export function useBrainHost() {
  return useBrainSelection("host");
}
export function useBrainPreferences() {
  return useBrainSelection("preferences");
}
