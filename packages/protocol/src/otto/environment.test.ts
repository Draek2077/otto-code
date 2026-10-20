import { describe, expect, it } from "vitest";
import { applyOttoEnvironment } from "./environment.js";

describe("applyOttoEnvironment", () => {
  it("maps OTTO_* variables onto their PASEO_* names", () => {
    const env: Record<string, string | undefined> = {
      OTTO_HOME: "/data/otto",
      OTTO_LISTEN: "127.0.0.1:6788",
    };
    applyOttoEnvironment(env);
    expect(env.PASEO_HOME).toBe("/data/otto");
    expect(env.PASEO_LISTEN).toBe("127.0.0.1:6788");
  });

  it("keeps a PASEO_* value that is already set", () => {
    const env: Record<string, string | undefined> = {
      OTTO_HOME: "/shell/otto",
      PASEO_HOME: "/spawned/agent/home",
    };
    applyOttoEnvironment(env);
    expect(env.PASEO_HOME).toBe("/spawned/agent/home");
  });

  it("leaves unrelated and unset variables alone", () => {
    const env: Record<string, string | undefined> = { PATH: "/bin", OTTO_EMPTY: undefined };
    applyOttoEnvironment(env);
    expect(env).toEqual({ PATH: "/bin", OTTO_EMPTY: undefined });
  });
});
