/**
 * Provider-neutral browser authorization driver. Drivers own vendor protocol,
 * callback URLs, PKCE, and account lookup; this registry owns discoverability
 * and the daemon-side entry point used by Settings.
 */
export interface BrowserAuthorizationDriver {
  integrationId: string;
  connectionId: string;
  start(): Promise<{ authorizationUrl: string }>;
}

export class IntegrationBrowserAuthorizationService {
  private readonly drivers = new Map<string, BrowserAuthorizationDriver>();

  register(driver: BrowserAuthorizationDriver): void {
    const key = browserAuthorizationDriverKey(driver);
    if (this.drivers.has(key)) {
      throw new Error(`A browser authorization driver is already registered for ${key}.`);
    }
    this.drivers.set(key, driver);
  }

  async start(params: {
    integrationId: string;
    connectionId: string;
  }): Promise<{ authorizationUrl: string }> {
    const driver = this.drivers.get(browserAuthorizationDriverKey(params));
    if (!driver) {
      throw new BrowserAuthorizationDriverUnavailableError(
        "This sign-in method is not configured on this host.",
      );
    }
    return driver.start();
  }
}

function browserAuthorizationDriverKey(params: {
  integrationId: string;
  connectionId: string;
}): string {
  return `${params.integrationId}:${params.connectionId}`;
}

export class BrowserAuthorizationDriverUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BrowserAuthorizationDriverUnavailableError";
  }
}
