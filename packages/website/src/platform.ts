import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

export type DesktopPlatform = "mac" | "windows" | "linux";
export type MobilePlatform = "ios" | "android";
export type VisitorPlatform = DesktopPlatform | MobilePlatform;

export function isMobilePlatform(platform: VisitorPlatform): platform is MobilePlatform {
  return platform === "ios" || platform === "android";
}

/**
 * Order matters: Android user agents also say "Linux", and iOS ones also say
 * "like Mac OS X". iPadOS Safari sends a desktop Mac user agent with no mobile
 * marker at all, so an iPad is detected as a Mac — there is no server-side
 * signal that separates them.
 */
export function detectPlatform(userAgent: string): VisitorPlatform {
  const ua = userAgent.toLowerCase();
  if (/android/.test(ua)) return "android";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/windows|win32|win64/.test(ua)) return "windows";
  if (/linux|x11|cros/.test(ua)) return "linux";
  return "mac";
}

/**
 * Resolved during SSR so the first paint already shows the correct distribution target.
 * server-entry marks HTML and server-function responses private/no-store and varies by User-Agent.
 */
export const getVisitorPlatform = createServerFn({ method: "GET" }).handler(
  (): VisitorPlatform => detectPlatform(getRequestHeader("user-agent") ?? ""),
);
