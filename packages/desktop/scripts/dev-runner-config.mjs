export function createElectronSpawnOptions({ env, colorEnv, expoDevUrl, devBuildLabel }) {
  return {
    // Electron must stay in the runner's process group. Otto workspace scripts
    // own the terminal process group, so detaching Electron lets it survive a
    // service stop with broken stdout/stderr pipes and block the next launch.
    detached: false,
    // Otto addition: Windows would otherwise flash a console window for the
    // spawned Electron process. Harmless elsewhere, so it is applied by platform
    // rather than by caller.
    ...(process.platform === "win32" ? { windowsHide: true } : {}),
    env: {
      ...env,
      ...colorEnv,
      EXPO_DEV_URL: expoDevUrl,
      ...(devBuildLabel ? { EXPO_PUBLIC_OTTO_DEV_BUILD_LABEL: devBuildLabel } : {}),
    },
  };
}

export function resolveChildKillTarget(pid, detached) {
  return detached ? -pid : pid;
}

export function registerDevRunnerShutdownSignals({ signalSource, stop }) {
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    signalSource.on(signal, () => stop("SIGTERM"));
  }
}
