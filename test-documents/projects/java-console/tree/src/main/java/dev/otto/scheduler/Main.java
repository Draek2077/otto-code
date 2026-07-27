package dev.otto.scheduler;

public final class Main {

    private Main() {}

    public static void main(String[] args) {
        Scheduler scheduler = seed();

        System.out.println("Drain order");
        System.out.println("-".repeat(52));
        scheduler.drainOrder().forEach(System.out::println);

        System.out.println();
        System.out.printf("tasks:  %d%n", scheduler.size());
        System.out.printf("total:  %d min%n", scheduler.totalEstimate().toMinutes());
        scheduler.next().ifPresent(task -> System.out.printf("next:   %s%n", task.name()));

        if (args.length > 0 && args[0].equals("--long")) {
            System.out.println();
            System.out.println("Long running (worth splitting):");
            scheduler.longRunning().forEach(task -> System.out.println("  " + task.name()));
        }
    }

    static Scheduler seed() {
        Scheduler scheduler = new Scheduler();
        scheduler.submit(Task.of("OTTO-1", "Restore the daemon socket", Priority.CRITICAL, 25));
        scheduler.submit(Task.of("OTTO-2", "Rebuild the search index", Priority.CRITICAL, 180));
        scheduler.submit(Task.of("OTTO-3", "Tidy the changelog", Priority.LOW, 15));
        scheduler.submit(Task.of("OTTO-4", "Migrate the config schema", Priority.HIGH, 90));
        scheduler.submit(Task.of("OTTO-5", "Answer the support queue", Priority.NORMAL, 45));
        return scheduler;
    }
}
