import {
  parseVisualizerFrame,
  visualizerFrame,
  VISUALIZER_MAX_EVENTS,
  type VisualizerCommand,
  type VisualizerEvent,
  type VisualizerGuestMessage,
} from "@getpaseo/visualizer/contracts";

export type VisualizerTransport = (message: string) => void;
/** One guest lifetime. No unbounded pre-ready queue: canonical state replays on
 * ready/reconnect, and controls cannot target a stale guest. */
export class VisualizerBridge {
  private transport: VisualizerTransport | null = null;
  private ready = false;
  constructor(
    readonly channel: string,
    private readonly receive: (message: VisualizerGuestMessage) => void,
  ) {}
  attach = (transport: VisualizerTransport | null) => {
    this.transport = transport;
    if (!transport) this.ready = false;
  };
  accept = (input: unknown) => {
    const message = parseVisualizerFrame(input, this.channel, true);
    if (!message || !this.transport) return;
    if (message.type === "ready") this.ready = true;
    if (this.ready) this.receive(message);
  };
  send = (message: VisualizerCommand) => {
    if (!this.ready || !this.transport) return false;
    this.transport(JSON.stringify(visualizerFrame(this.channel, message)));
    return true;
  };
  events(events: readonly VisualizerEvent[], hydrate: boolean) {
    // Each event is already a bounded presentation projection. Keep frames
    // below the transport's cap even for the largest allowed message text.
    for (let index = 0; index < Math.min(events.length, VISUALIZER_MAX_EVENTS); index += 24) {
      this.send({ type: "agent-event-batch", events: events.slice(index, index + 24), hydrate });
    }
  }
  dispose() {
    this.transport = null;
    this.ready = false;
  }
}
export function prepareVisualizerHtml(
  html: string,
  channel: string,
  scale: number,
  themeJson?: string,
) {
  if (!/^[A-Za-z0-9-]{8,128}$/u.test(channel)) throw new Error("Invalid Visualizer channel");
  let result = html.replace('"__OTTO_VISUALIZER_CHANNEL__"', JSON.stringify(channel));
  result = result.replace(
    '"__OTTO_DPR_CAP__"',
    JSON.stringify(String(Math.max(1, Math.min(4, scale)))),
  );
  if (themeJson)
    result = result.replace(
      '"__OTTO_THEME_JSON__"',
      JSON.stringify(themeJson).replace(/</gu, "\\u003c"),
    );
  return result;
}
