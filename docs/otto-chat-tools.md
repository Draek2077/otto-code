# Chat widgets and suggested tasks

## Widgets

Agents use `widget_contract` and `show_widget` for inline SVG or HTML visuals.
The normal Otto tool catalog supplies the same contract to MCP and native
tool-loop providers. Otto projects only its widget tool calls into bounded
versioned metadata on the existing timeline row. The built-in client renderer
uses that metadata through the Paseo timeline extension point. Ordinary rows,
timeline epochs, and provider adapters keep their existing owners.

The web renderer uses an opaque sandbox and a per-frame message port. Electron
uses a private, non-persistent guest with a fixed sandboxed preload, denied
permissions and blocked network and navigation. Native uses the constrained
WebView renderer. The bridge validates dimensions and payload sizes. A widget
interaction can stage text in the focused chat's draft. The composer keeps its
existing text and attachments and owns the Send action.

## Suggested tasks

`suggest_task` renders a task proposal. Its launch text stays on the owning
daemon until an explicit Start request needs it. `dismiss_task` withdraws a
suggestion from the originating chat. Suggestions are bounded, session-local
receipts addressed by host, workspace, chat, and suggestion ID.

New chat, Sub-agent, and Worktree use the existing create-agent command.
The shared model picker can override the source chat's model. In session
passes the confirmed launch text to the existing composer queue. It preserves
typed input and leaves dispatch to Paseo. A launch whose outcome is unknown
must be inspected before another task is started.

## Inline prompt suggestions

Claude can send a predicted next prompt after an ordinary chat turn. Otto forwards it only to compatible clients viewing that chat. The composer shows it while the draft is empty. Tap **Use suggestion** or press Tab to insert editable text. Sending remains a separate action. Predictions are transient and never become transcript entries.

The **AI prompt suggestions** setting controls display. Claude defaults to enabled for ordinary chats. Host operators can disable generation with the Claude provider option `promptSuggestions: false` or `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`. Workflows and isolated generation sessions do not request predictions.

## Observed subagents

Paseo's provider-subagent descriptors and read-only transcript own the view,
nested tracks, and replay. Otto adds Stop for a live Claude task announced by
the parent's current query. The daemon requires the exact observed descriptor,
workspace, parent, and provider task identity. Replayed and finished tasks have
no stop target. The parent chat keeps its own lifecycle.
