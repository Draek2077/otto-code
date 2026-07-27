package dev.otto.scheduler;

/** Ordered lowest to highest; ordinal() is the comparison key, so declaration order matters. */
public enum Priority {
    LOW,
    NORMAL,
    HIGH,
    CRITICAL;

    public boolean outranks(Priority other) {
        return ordinal() > other.ordinal();
    }
}
