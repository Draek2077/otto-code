import type { GoogleConnectorService } from "@otto-code/protocol/provider-config";
import type { GoogleConnectorTool } from "./google-tool-definition.js";
import { gmailTools } from "./google-gmail-tools.js";
import { driveTools } from "./google-drive-tools.js";
import { calendarTools } from "./google-calendar-tools.js";

export function googleConnectorTools(service: GoogleConnectorService): GoogleConnectorTool[] {
  if (service.id === "gmail") return gmailTools();
  if (service.id === "google-drive") return driveTools();
  return calendarTools();
}
