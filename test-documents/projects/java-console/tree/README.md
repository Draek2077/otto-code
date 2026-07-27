# scheduler

A priority-ordered task queue in about two hundred lines. No build tool, no test
framework — a JDK on `PATH` is the whole toolchain.

```bash
javac -d out -sourcepath src/main/java src/main/java/dev/otto/scheduler/Main.java src/main/java/dev/otto/scheduler/SelfTest.java
java -cp out dev.otto.scheduler.SelfTest
java -cp out dev.otto.scheduler.Main
java -cp out dev.otto.scheduler.Main --long
```

```
Drain order
----------------------------------------------------
OTTO-1     Restore the daemon socket CRITICAL  25 min
OTTO-2     Rebuild the search index CRITICAL 180 min
OTTO-4     Migrate the config schema HIGH      90 min
OTTO-5     Answer the support queue NORMAL    45 min
OTTO-3     Tidy the changelog       LOW       15 min
```

## Ordering

Priority descending, then estimate ascending. The second key is the interesting one:
among equally urgent work the short jobs drain first, so queue length keeps falling
instead of stalling behind one long task. `OTTO-1` (25 min) therefore heads the queue
ahead of `OTTO-2` (180 min) even though both are `CRITICAL`.

## Layout

| File               | What it holds                                                     |
| ------------------ | ------------------------------------------------------------------ |
| `Priority.java`    | Enum ordered lowest to highest — declaration order is the comparison key |
| `Task.java`        | Record with a compact constructor doing the validation             |
| `Scheduler.java`   | The queue, the comparator, and the stream-based reports            |
| `Main.java`        | Console output and the demo seed                                   |
| `SelfTest.java`    | Hand-rolled assertions; exits 1 on the first failure               |

## Design notes

**`Task` is a record.** A task is a value — two with the same fields are the same
task, and nothing should be mutating one that is sitting in a queue. The compact
constructor does the validation, so an invalid `Task` cannot be constructed at all.

**`Priority` compares by `ordinal()`.** That makes declaration order load-bearing:
reordering the constants silently reorders the queue. Called out here because it is
exactly the kind of change that looks cosmetic in review.

**No JUnit.** `SelfTest` is a `main` that prints `ok`/`FAIL` and exits non-zero. A real
project would take the dependency; this one stays dependency-free so the fixture builds
offline with nothing installed.
