const DEFAULT_CAPACITY = 500;

/**
 * In-memory telemetry store: a fixed-capacity ring buffer of events
 * plus a map of named gauges (latest value wins).
 */
export class EventStore {
  #slots;
  #writeIndex = 0;
  #count = 0;
  #gauges = new Map();

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.#slots = new Array(capacity);
  }

  /** Append an event, evicting the oldest once the buffer is full. */
  push(event) {
    this.#slots[this.#writeIndex] = event;
    this.#writeIndex = (this.#writeIndex + 1) % this.capacity;
    this.#count = Math.min(this.#count + 1, this.capacity);
  }

  /** Newest-first slice of buffered events. */
  recent(limit = 50) {
    const take = Math.min(limit, this.#count);
    const events = [];
    for (let i = 1; i <= take; i++) {
      events.push(this.#slots[(this.#writeIndex - i + this.capacity) % this.capacity]);
    }
    return events;
  }

  get size() {
    return this.#count;
  }

  /** Latest-value-wins gauge, e.g. cpu.load or queue.depth. */
  recordGauge(name, value) {
    this.#gauges.set(name, { value, updatedAt: new Date().toISOString() });
  }

  gaugeSnapshot() {
    return Object.fromEntries(this.#gauges);
  }
}
