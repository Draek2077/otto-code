import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import { WIDGET_MAX_LOADING_MESSAGES } from "@otto-code/protocol/widgets/types";
import { sanitizeWidgetFragment } from "../../widget/widget-fragment.js";
import { WIDGET_CONTRACT_MODULES, readWidgetContract } from "../../widget/widget-contract.js";
import type { RegisterOttoTool } from "./types.js";

interface Dependencies {
  registerTool: RegisterOttoTool;
}

export function registerWidgetsTools({ registerTool }: Dependencies): void {
  registerTool(
    "show_widget",
    {
      title: "Show a widget",
      description:
        "Render a visual inline in the conversation - an SVG diagram or chart, an HTML " +
        "dashboard, a mockup, a small interactive control. It appears in the transcript at " +
        "this point in your reply, next to the text explaining it.\n\n" +
        "Reach for this whenever a picture carries the answer better than prose: comparing " +
        "options, showing a flow or an architecture, plotting numbers, sketching UI, laying " +
        "out anything with two dimensions. Do not narrate what you are about to draw - draw it.\n\n" +
        "Call widget_contract FIRST, before your first widget, and follow what it says. It " +
        "carries the theme variables, the icon set, the two host globals, and the sandbox " +
        "limits - none of which you can guess. There is NO network: no CDN, no Chart.js, no " +
        "D3, no web fonts. Everything is inline HTML/CSS/SVG/JS.\n\n" +
        "A widget is not an artifact. Use this for something that explains the answer here " +
        "and now; use create_artifact for a document the user will come back to.",
      inputSchema: {
        // Declared before widget_code on purpose. Providers stream tool inputs
        // in declaration order and withhold a string argument until it closes,
        // so the fields listed first arrive while the fragment is still being
        // written - which is what lets Otto show these messages instead of a
        // dead spinner.
        loading_messages: z
          .array(z.string())
          .min(1)
          .max(WIDGET_MAX_LOADING_MESSAGES)
          .describe(
            "1-4 short lines shown while the widget renders, roughly five words each, in the " +
              "user's language. If the subject is serious - illness, grief, conflict, disaster, " +
              'money someone could lose - keep them flat and factual ("Laying out the stages"). ' +
              "Otherwise have fun with them.",
          ),
        title: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Short snake_case identifier, specific enough to tell this widget apart from " +
              "others in the same conversation - q4_revenue_by_region, not chart.",
          ),
        widget_code: z
          .string()
          .min(1)
          .describe(
            "The fragment. Starts with <svg for SVG mode, otherwise HTML. No DOCTYPE, no " +
              "<html>/<head>/<body>. Content-driven height - never position:fixed and never a " +
              "height on html/body.",
          ),
      },
      outputSchema: {
        rendered: z.boolean(),
        mode: z.string(),
      },
    },
    async (input: { widget_code: string; title: string; loading_messages: string[] }) => {
      // The widget renders from the tool CALL, not from this result - the
      // fragment is already on its way to the client by the time this runs (see
      // widget-timeline.ts). The handler exists to validate, so a fragment that
      // cannot render comes back to the model as a fixable error instead of
      // leaving a broken frame in the transcript.
      const fragment = sanitizeWidgetFragment(input.widget_code);
      return {
        content: [],
        structuredContent: ensureValidJson({ rendered: true, mode: fragment.mode }),
      };
    },
  );

  registerTool(
    "widget_contract",
    {
      title: "Read the widget contract",
      description:
        "Return the host contract for show_widget: theme variables, icon names, the " +
        "sendPrompt/openLink globals, sizing rules and sandbox limits. Call this before your " +
        "first widget in a conversation. Pass a module for detail on one kind of widget: " +
        `${WIDGET_CONTRACT_MODULES.join(", ")}.`,
      inputSchema: {
        module: z
          .string()
          .trim()
          .optional()
          .describe(
            `Optional module: ${WIDGET_CONTRACT_MODULES.join(", ")}. Omit for the core contract.`,
          ),
      },
      outputSchema: {
        contract: z.string(),
      },
    },
    async (input: { module?: string }) => {
      return {
        content: [],
        structuredContent: ensureValidJson({ contract: readWidgetContract(input.module) }),
      };
    },
  );
}
