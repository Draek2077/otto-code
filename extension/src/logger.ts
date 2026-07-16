/**
 * Structured logger for the extension.
 * Wraps console.* with tagged prefixes and consistent formatting.
 * Centralizes all logging so it can be silenced or redirected later.
 */

const LOG_LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 }

let minLevel = 'info'

/** Set the minimum log level (debug, info, warn, error) */
export function setLogLevel(level: string) {
  if (level in LOG_LEVELS) minLevel = level
}

function shouldLog(level: string): boolean {
  return (LOG_LEVELS[level] ?? 0) >= (LOG_LEVELS[minLevel] ?? 0)
}

/** Create a tagged logger for a specific module */
export function createLogger(tag: string) {
  const prefix = `[${tag}]`
  return {
    debug(...args: unknown[]) {
      if (shouldLog('debug')) console.log(prefix, ...args)
    },
    info(...args: unknown[]) {
      if (shouldLog('info')) console.log(prefix, ...args)
    },
    warn(...args: unknown[]) {
      if (shouldLog('warn')) console.warn(prefix, ...args)
    },
    error(...args: unknown[]) {
      if (shouldLog('error')) console.error(prefix, ...args)
    },
  }
}
