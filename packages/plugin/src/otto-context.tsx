import type { OttoApi } from "@otto-code/client";
import { createContext, useContext, type ReactNode } from "react";

const OttoApiContext = createContext<OttoApi | null>(null);

export function OttoApiProvider({ children, otto }: { children: ReactNode; otto: OttoApi }) {
  return <OttoApiContext.Provider value={otto}>{children}</OttoApiContext.Provider>;
}

export function useOtto(): OttoApi {
  const otto = useContext(OttoApiContext);
  if (!otto) throw new Error("useOtto must run inside a contributed plugin surface");
  return otto;
}
