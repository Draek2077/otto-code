import type { IntegrationAuthorizationMethodOption } from "@otto-code/protocol/integration-authorization";

/**
 * Provider declarations for the reusable Integration settings surface. It
 * carries no credentials and does not make a method claim usable until its
 * daemon driver is actually registered.
 */
export class IntegrationAuthorizationCatalog {
  private readonly methodsByIntegration = new Map<string, IntegrationAuthorizationMethodOption[]>();

  registerMethods(methods: readonly IntegrationAuthorizationMethodOption[]): void {
    for (const method of methods) {
      const registered = this.methodsByIntegration.get(method.integrationId) ?? [];
      if (registered.some((candidate) => candidate.method === method.method)) {
        throw new Error(
          `Integration authorization method already registered: ${method.integrationId}/${method.method}`,
        );
      }
      this.methodsByIntegration.set(method.integrationId, [...registered, method]);
    }
  }

  listMethods(integrationId?: string): IntegrationAuthorizationMethodOption[] {
    if (integrationId) return [...(this.methodsByIntegration.get(integrationId) ?? [])];
    return [...this.methodsByIntegration.values()]
      .flat()
      .sort((left, right) => left.integrationId.localeCompare(right.integrationId));
  }

  getMethod(params: {
    integrationId: string;
    method: string;
  }): IntegrationAuthorizationMethodOption | null {
    return (
      this.methodsByIntegration
        .get(params.integrationId)
        ?.find((candidate) => candidate.method === params.method) ?? null
    );
  }
}
