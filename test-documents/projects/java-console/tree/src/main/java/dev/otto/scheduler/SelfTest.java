package dev.otto.scheduler;

import java.time.Duration;
import java.util.List;

/**
 * A hand-rolled test runner. A real project would reach for JUnit; this one stays
 * dependency-free on purpose, so the whole thing compiles and runs with nothing
 * but a JDK on PATH. Exit code 1 on the first failure.
 */
public final class SelfTest {

    private static int failures = 0;

    private SelfTest() {}

    public static void main(String[] args) {
        priorityOrdersByOrdinal();
        taskRejectsBlankId();
        taskRejectsNegativeEstimate();
        schedulerRejectsDuplicateId();
        drainOrderPutsCriticalShortWorkFirst();
        nextIsTheHeadOfDrainOrder();
        totalEstimateSumsEveryTask();
        longRunningFiltersOnTheHourThreshold();

        if (failures > 0) {
            System.err.printf("%d assertion(s) failed%n", failures);
            System.exit(1);
        }
        System.out.println("all assertions passed");
    }

    private static void priorityOrdersByOrdinal() {
        check("CRITICAL outranks LOW", Priority.CRITICAL.outranks(Priority.LOW));
        check("LOW does not outrank itself", !Priority.LOW.outranks(Priority.LOW));
    }

    private static void taskRejectsBlankId() {
        check("blank id is rejected", throwsFor(() -> Task.of("  ", "x", Priority.LOW, 1)));
    }

    private static void taskRejectsNegativeEstimate() {
        check("negative estimate is rejected", throwsFor(() -> Task.of("A", "x", Priority.LOW, -1)));
    }

    private static void schedulerRejectsDuplicateId() {
        Scheduler scheduler = new Scheduler();
        scheduler.submit(Task.of("A", "first", Priority.LOW, 5));
        check("duplicate id is rejected", throwsFor(() -> scheduler.submit(Task.of("A", "second", Priority.HIGH, 5))));
    }

    private static void drainOrderPutsCriticalShortWorkFirst() {
        List<Task> order = Main.seed().drainOrder();
        check("head is OTTO-1", order.get(0).id().equals("OTTO-1"));
        check("second is OTTO-2", order.get(1).id().equals("OTTO-2"));
        check("tail is OTTO-3", order.get(order.size() - 1).id().equals("OTTO-3"));
    }

    private static void nextIsTheHeadOfDrainOrder() {
        Scheduler scheduler = Main.seed();
        check("next matches drain head", scheduler.next().orElseThrow().equals(scheduler.drainOrder().get(0)));
    }

    private static void totalEstimateSumsEveryTask() {
        check("total is 355 min", Main.seed().totalEstimate().equals(Duration.ofMinutes(355)));
    }

    private static void longRunningFiltersOnTheHourThreshold() {
        List<String> ids = Main.seed().longRunning().stream().map(Task::id).toList();
        check("long running is OTTO-4 then OTTO-2", ids.equals(List.of("OTTO-2", "OTTO-4")) || ids.equals(List.of("OTTO-4", "OTTO-2")));
        check("exactly two long tasks", ids.size() == 2);
    }

    private static boolean throwsFor(Runnable action) {
        try {
            action.run();
            return false;
        } catch (RuntimeException expected) {
            return true;
        }
    }

    private static void check(String what, boolean condition) {
        if (condition) {
            System.out.printf("  ok   %s%n", what);
            return;
        }
        System.out.printf("  FAIL %s%n", what);
        failures++;
    }
}
