// Regenerates every shipped brand asset from the masters in branding/.
// Usage: node scripts/generate-brand-assets.mjs
// See branding/README.md for the geometry contract.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brandingDir = path.join(root, "branding");
const appImages = path.join(root, "packages/app/assets/images");
const appPublic = path.join(root, "packages/app/public");
const desktopAssets = path.join(root, "packages/desktop/assets");
const websitePublic = path.join(root, "packages/website/public");

const TILE_RADIUS = 114; // 512-scale equivalent of the previous 156/700 favicon tile
const BADGE = { cx: 417, cy: 417, r: 95 };
const BADGE_COLORS = { running: "#3b82f6", attention: "#22c55e" };
// Tray "needs your attention" accent — amber-500, matching theme.colors.palette.amber[500]
// (packages/app/src/styles/theme.ts) so the tray accent reuses the app's existing warning color.
const TRAY_ATTENTION_COLOR = "#f59e0b";

function extractInner(svgText) {
  return svgText.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
}

function colored(inner, color) {
  return inner.replaceAll("currentColor", color);
}

function faceAt(inner, color, x, y, size) {
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 512 512" fill="none">${colored(inner, color)}</svg>`;
}

function wrap(content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">${content}</svg>`;
}

// Black rounded tile + white face; used for favicons, PWA, splash, and desktop icons.
// `badge` is either a known status key (looked up in BADGE_COLORS), a raw CSS color
// string, or null/undefined for no badge.
function tileSvg(faceInner, badge) {
  const badgeColor = badge ? (BADGE_COLORS[badge] ?? badge) : null;
  const badgeCircle = badgeColor
    ? `<circle cx="${BADGE.cx}" cy="${BADGE.cy}" r="${BADGE.r}" fill="${badgeColor}"/>`
    : "";
  return wrap(
    `<rect width="512" height="512" rx="${TILE_RADIUS}" fill="black"/>` +
      faceAt(faceInner, "white", 24, 24, 464) +
      badgeCircle,
  );
}

// Full-bleed black square + white face; iOS/apple-touch (the OS applies its own mask).
function fullBleedSvg(faceInner) {
  return wrap(
    `<rect width="512" height="512" fill="black"/>` + faceAt(faceInner, "white", 56, 56, 400),
  );
}

// Transparent background + single-color face.
function bareSvg(faceInner, color, scale = 1) {
  const size = Math.round(512 * scale);
  const offset = Math.round((512 - size) / 2);
  return wrap(faceAt(faceInner, color, offset, offset, size));
}

async function png(svg, size, file) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
  console.log(`wrote ${path.relative(root, file)} (${size}x${size})`);
}

async function pngBuffer(svg, size) {
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

// ICO container with embedded PNGs (valid since Windows Vista).
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  const blobs = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

// ICNS container with PNG-encoded entries (macOS 10.7+).
const ICNS_TYPES = [
  ["icp4", 16],
  ["icp5", 32],
  ["ic11", 32],
  ["ic12", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic13", 256],
  ["ic09", 512],
  ["ic14", 512],
  ["ic10", 1024],
];

function buildIcns(pngBySize) {
  const chunks = [];
  for (const [type, size] of ICNS_TYPES) {
    const data = pngBySize.get(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(8 + data.length, 4);
    chunks.push(header, data);
  }
  const body = Buffer.concat(chunks);
  const fileHeader = Buffer.alloc(8);
  fileHeader.write("icns", 0, "ascii");
  fileHeader.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([fileHeader, body]);
}

const iconText = await readFile(path.join(brandingDir, "otto-icon.svg"), "utf8");
const iconSmallText = await readFile(path.join(brandingDir, "otto-icon-small.svg"), "utf8");
const iconWinkSmallText = await readFile(
  path.join(brandingDir, "otto-icon-wink-small.svg"),
  "utf8",
);
const face = extractInner(iconText);
// Simplified face (no lens rings, solid pupils) for anything rendered at <= 48px,
// where the concentric eye rings fuse into mush.
const faceSmall = extractInner(iconSmallText);
const faceWinkSmall = extractInner(iconWinkSmallText);
const SMALL_FACE_MAX_PX = 48;

await mkdir(appPublic, { recursive: true });

// App favicons: light/dark schemes share the same black tile (matches previous assets),
// with status badge variants consumed by use-favicon-status.ts.
for (const scheme of ["light", "dark"]) {
  for (const status of ["none", "running", "attention"]) {
    const suffix = status === "none" ? "" : `-${status}`;
    const svg = tileSvg(faceSmall, status === "none" ? null : status);
    const base = path.join(appImages, `favicon-${scheme}${suffix}`);
    await writeFile(`${base}.svg`, svg + "\n");
    await png(svg, 48, `${base}.png`);
  }
}
await png(tileSvg(faceSmall, null), 48, path.join(appImages, "favicon.png"));

// Expo-managed icons.
await png(fullBleedSvg(face), 1024, path.join(appImages, "icon.png"));
await png(bareSvg(face, "white", 0.62), 1024, path.join(appImages, "android-icon-foreground.png"));
await png(tileSvg(face, null), 200, path.join(appImages, "splash-icon.png"));
await png(bareSvg(faceSmall, "white", 0.9), 96, path.join(appImages, "notification-icon.png"));

// Web/PWA icons.
await png(tileSvg(face, null), 192, path.join(appPublic, "pwa-icon-192.png"));
await png(tileSvg(face, null), 512, path.join(appPublic, "pwa-icon-512.png"));
await png(fullBleedSvg(face), 180, path.join(appPublic, "apple-touch-icon.png"));

// Desktop (electron-builder consumes icon.png/icon.ico/icon.icns).
await png(tileSvg(face, null), 512, path.join(desktopAssets, "icon.png"));
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPngs = [];
for (const size of icoSizes) {
  const inner = size <= SMALL_FACE_MAX_PX ? faceSmall : face;
  icoPngs.push({ size, data: await pngBuffer(tileSvg(inner, null), size) });
}
await writeFile(path.join(desktopAssets, "icon.ico"), buildIco(icoPngs));
console.log("wrote packages/desktop/assets/icon.ico");
const icnsSizes = new Map();
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  const inner = size <= SMALL_FACE_MAX_PX ? faceSmall : face;
  icnsSizes.set(size, await pngBuffer(tileSvg(inner, null), size));
}
await writeFile(path.join(desktopAssets, "icon.icns"), buildIcns(icnsSizes));
console.log("wrote packages/desktop/assets/icon.icns");

// Linux/notification fallback sizes: electron-builder's `icon: assets` directory target
// (electron-builder.yml) and the notification icon fallback chain (notifications.ts) both
// expect loose NxN.png files alongside icon.png/ico/icns.
const looseSizes = [
  [32, "32x32.png"],
  [64, "64x64.png"],
  [128, "128x128.png"],
  [256, "128x128@2x.png"],
];
for (const [size, name] of looseSizes) {
  const inner = size <= SMALL_FACE_MAX_PX ? faceSmall : face;
  await png(tileSvg(inner, null), size, path.join(desktopAssets, name));
}

// Website: white face for the header/docs logo, tile for the favicon.
await writeFile(
  path.join(websitePublic, "logo.svg"),
  wrap(colored(face, "white")).replace("<svg ", '<svg width="32" height="32" ') + "\n",
);
await writeFile(
  path.join(websitePublic, "favicon.svg"),
  tileSvg(faceSmall, null).replace("<svg ", '<svg width="48" height="48" ') + "\n",
);
const websiteIcoPngs = [];
for (const size of [16, 32, 48]) {
  websiteIcoPngs.push({ size, data: await pngBuffer(tileSvg(faceSmall, null), size) });
}
await writeFile(path.join(websitePublic, "favicon.ico"), buildIco(websiteIcoPngs));
console.log("wrote packages/website/public/favicon.ico + logo.svg + favicon.svg");

// Tray icons (packages/desktop/src/features/tray.ts loads these by name at runtime).
// Windows/Linux: colored tile, matching the taskbar/app-indicator convention.
await png(tileSvg(faceSmall, null), 32, path.join(desktopAssets, "tray-icon.png"));
await png(
  tileSvg(faceWinkSmall, TRAY_ATTENTION_COLOR),
  32,
  path.join(desktopAssets, "tray-icon-attention.png"),
);
// macOS idle: template image — a bare black glyph on transparent, no tile. Electron
// re-tints template images for the current menu-bar theme (setTemplateImage(true)).
await png(bareSvg(faceSmall, "black", 0.82), 22, path.join(desktopAssets, "tray-icon-mac.png"));
await png(bareSvg(faceSmall, "black", 0.82), 44, path.join(desktopAssets, "tray-icon-mac@2x.png"));
// macOS attention: NOT a template image (needs to show the amber accent), so it keeps
// the tile for contrast against both light and dark menu bars.
await png(
  tileSvg(faceWinkSmall, TRAY_ATTENTION_COLOR),
  22,
  path.join(desktopAssets, "tray-icon-mac-attention.png"),
);
await png(
  tileSvg(faceWinkSmall, TRAY_ATTENTION_COLOR),
  44,
  path.join(desktopAssets, "tray-icon-mac-attention@2x.png"),
);

console.log("done");
