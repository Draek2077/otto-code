import { Asset } from "expo-asset";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { DEFAULT_MONO_FONT_STACK, DEFAULT_UI_FONT_STACK } from "@/styles/theme";

// The View renders in an isolated, offline guest (CSP `font-src data:`), so the
// app's bundled fonts are invisible to it. Embedding the faces Otto bundles
// keeps the default content and code fonts identical inside a View (and in
// its exports). A user-chosen system font needs nothing: the guest resolves
// installed fonts by name.
interface BundledFace {
  family: string;
  source: Parameters<typeof Asset.fromModule>[0];
  defaultStack: string;
}

const BUNDLED_FACES: readonly BundledFace[] = [
  { family: "Inter_400Regular", source: Inter_400Regular, defaultStack: DEFAULT_UI_FONT_STACK },
  {
    family: "JetBrainsMono_400Regular",
    source: JetBrainsMono_400Regular,
    defaultStack: DEFAULT_MONO_FONT_STACK,
  },
];

const loadedFaces = new Map<string, Promise<string | null>>();

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Font could not be read.")),
    );
    reader.readAsDataURL(blob);
  });
}

async function loadBundledFontFace(face: BundledFace): Promise<string | null> {
  const asset = Asset.fromModule(face.source);
  const response = await fetch(asset.uri);
  if (!response.ok) return null;
  const dataUrl = await readAsDataUrl(await response.blob());
  const source = dataUrl.replace(/^data:[^;,]*/, "data:font/ttf");
  return `@font-face { font-family: '${face.family}'; src: url(${source}) format('truetype'); font-weight: 100 900; font-display: block; }`;
}

function bundledFaceFor(stack: string): BundledFace | null {
  const first = stack
    .split(",")[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, "");
  return BUNDLED_FACES.find((face) => first === face.family || stack === face.defaultStack) ?? null;
}

/**
 * Resolves the `@font-face` rule a View needs for the given font stack, or
 * null when the guest can resolve the font by itself. Loads each bundled face
 * once per session; a failed load falls back to the stack's system fonts.
 */
export function resolveInteractiveViewFontFace(stack: string): Promise<string | null> {
  const face = bundledFaceFor(stack);
  if (!face) return Promise.resolve(null);
  let loaded = loadedFaces.get(face.family);
  if (!loaded) {
    loaded = loadBundledFontFace(face).catch(() => null);
    loadedFaces.set(face.family, loaded);
  }
  return loaded;
}
