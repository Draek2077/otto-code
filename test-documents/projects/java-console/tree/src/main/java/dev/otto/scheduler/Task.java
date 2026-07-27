package dev.otto.scheduler;

import java.time.Duration;
import java.util.Objects;

/**
 * A unit of work. A record because a task is a value: two tasks with the same
 * fields are the same task, and nothing should be mutating one in a queue.
 */
public record Task(String id, String name, Priority priority, Duration estimate) {

    public Task {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(priority, "priority");
        Objects.requireNonNull(estimate, "estimate");
        if (id.isBlank()) {
            throw new IllegalArgumentException("task id cannot be blank");
        }
        if (estimate.isNegative()) {
            throw new IllegalArgumentException("estimate cannot be negative");
        }
    }

    public static Task of(String id, String name, Priority priority, long minutes) {
        return new Task(id, name, priority, Duration.ofMinutes(minutes));
    }

    /** Long tasks are the ones worth splitting; the threshold is a policy, not a law. */
    public boolean isLongRunning() {
        return estimate.toMinutes() > 60;
    }

    @Override
    public String toString() {
        return "%-10s %-24s %-8s %3d min".formatted(id, name, priority, estimate.toMinutes());
    }
}
