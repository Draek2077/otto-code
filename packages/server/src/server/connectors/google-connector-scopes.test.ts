import { expect, test } from "vitest";
import { GOOGLE_CONNECTOR_SERVICES } from "@otto-code/protocol/provider-config";
import { googleConnectorTools } from "./google-connector-tools.js";
import {
  GOOGLE_CONNECTOR_IDENTITY_SCOPES,
  GOOGLE_CONNECTOR_OPERATION_SCOPES,
  GOOGLE_CONNECTOR_PORTAL_SCOPES,
} from "./google-connector-scopes.js";

test("every shipped Google operation has requested and publisher-configured scopes", () => {
  for (const service of GOOGLE_CONNECTOR_SERVICES) {
    const operations = GOOGLE_CONNECTOR_OPERATION_SCOPES[service.id];
    expect(Object.keys(operations).sort()).toEqual(
      googleConnectorTools(service)
        .map((t) => t.name)
        .sort(),
    );
    for (const scope of [...service.scopes, ...GOOGLE_CONNECTOR_IDENTITY_SCOPES])
      expect(GOOGLE_CONNECTOR_PORTAL_SCOPES).toContain(scope);
    for (const scopes of Object.values(operations))
      for (const scope of scopes)
        expect(service.scopes).toContain(`https://www.googleapis.com/auth/${scope}`);
  }
});
