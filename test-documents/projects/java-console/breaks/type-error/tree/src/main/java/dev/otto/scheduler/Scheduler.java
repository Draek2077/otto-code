package dev.otto.scheduler;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Priority-ordered task queue. Ordering is priority descending, then estimate
 * ascending — so among equally urgent work the short jobs drain first, which keeps
 * the queue length falling instead of stalling behind one long task.
 */
public final class Scheduler {

    private static final Comparator<Task> ORDER =
            Comparator.comparing(Task::priority, Comparator.reverseOrder())
                    .thenComparing(task -> task.estimate().toMinutes());

    private final List<Task> tasks = new ArrayList<>();

    public void submit(Task task) {
        if (tasks.stream().anyMatch(existing -> existing.id().equals(task.id()))) {
            throw new IllegalStateException("duplicate task id: " + task.id());
        }
        tasks.add(task);
    }

    public int size() {
        return tasks;
    }

    /** The queue in the order it will actually be worked. */
    public List<Task> drainOrder() {
        return tasks.stream().sorted(ORDER).collect(Collectors.toList());
    }

    public Optional<Task> next() {
        return tasks.stream().min(ORDER);
    }

    public Duration totalEstimate() {
        return tasks.stream().map(Task::estimate).reduce(Duration.ZERO, Duration::plus);
    }

    public Map<Priority, List<Task>> byPriority() {
        return tasks.stream().collect(Collectors.groupingBy(Task::priority));
    }

    public List<Task> longRunning() {
        return tasks.stream().filter(Task::isLongRunning).sorted(ORDER).toList();
    }
}
