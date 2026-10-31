const { withInfoPlist } = require("expo/config-plugins");
// Otto-owned playback capability. Recording remains foreground-only; Android's
// media playback service is supplied by the SDK-compatible expo-audio module.
module.exports = function withOttoSpeechBackground(config) {
  return withInfoPlist(config, (mod) => {
    const modes = Array.isArray(mod.modResults.UIBackgroundModes)
      ? mod.modResults.UIBackgroundModes
      : [];
    mod.modResults.UIBackgroundModes = [...new Set([...modes, "audio"])];
    return mod;
  });
};
