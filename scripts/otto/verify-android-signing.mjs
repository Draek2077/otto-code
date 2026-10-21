import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function singleDigest(output, pattern) {
  const digests = new Set(
    [...output.matchAll(pattern)].map((match) => match[1].replaceAll(":", "").toLowerCase()),
  );
  const [digest] = digests;
  if (digests.size !== 1 || !/^[a-f0-9]{64}$/.test(digest ?? "")) {
    throw new Error("Expected exactly one Android signer SHA-256 fingerprint");
  }
  return digest;
}

export function verifyAndroidSignerMatch(apkOutput, bundleOutput) {
  // apksigner versions label the same signer as either "Signer #1" or "V2 Signer".
  const apk = singleDigest(apkOutput, /^.*certificate SHA-256 digest:\s*([a-fA-F0-9]+)\s*$/gm);
  const bundle = singleDigest(bundleOutput, /^\s*SHA256:\s*([a-fA-F0-9:]+)\s*$/gm);
  if (apk !== bundle) throw new Error("APK and AAB signer certificates differ");
  return apk;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [apkPath, bundlePath] = process.argv.slice(2);
  if (!apkPath || !bundlePath) throw new Error("Provide APK and AAB certificate output files");
  verifyAndroidSignerMatch(readFileSync(apkPath, "utf8"), readFileSync(bundlePath, "utf8"));
  console.log("APK and AAB signer certificates match");
}
