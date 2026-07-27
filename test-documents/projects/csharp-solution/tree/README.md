# Otto.Ledger

A double-entry ledger in two projects. Small enough to read in one sitting, strict
enough that a lost transaction is impossible rather than unlikely.

```bash
dotnet build Otto.Ledger.sln
dotnet run --project src/Otto.Ledger.Cli
dotnet run --project src/Otto.Ledger.Cli -- --overdrawn
```

```
Trial balance
--------------------------------
Cash on hand        3,430.50 USD
Rent expense        1,750.00 USD
Revenue            -5,180.50 USD

entries:  6
balanced: yes
```

## Solution layout

| Project              | Responsibility                                                      |
| -------------------- | ------------------------------------------------------------------- |
| `Otto.Ledger.Core`   | Domain types and the ledger invariant. No I/O, no console.           |
| `Otto.Ledger.Cli`    | Composition and presentation; maps domain errors onto exit codes.     |

The dependency runs one way, enforced by the `ProjectReference` in the CLI's
`.csproj`. Core has no reference back.

### Two solution files, on purpose

`Otto.Ledger.sln` (classic) and `Otto.Ledger.slnx` (XML) describe the same two
projects. Carrying both is a real state for a codebase mid-migration — `.slnx`
arrived in recent SDKs and teams keep the classic file for older tooling. Because two
solution files sit in the folder, every command names one explicitly; a bare
`dotnet build` cannot pick.

## Documentation

| File                                                  | What it is                                    |
| ----------------------------------------------------- | --------------------------------------------- |
| [docs/architecture.adoc](docs/architecture.adoc)      | AsciiDoc with Mermaid sequence + class diagrams |
| [docs/project-plan.md](docs/project-plan.md)          | Milestones, out-of-scope, risk table            |
| [docs/test-plan.md](docs/test-plan.md)                | Layers and per-case checklist                   |
| [docs/trial-balance.html](docs/trial-balance.html)    | Rendered statement, light and dark             |
| [docs/diagrams/posting-flow.svg](docs/diagrams/posting-flow.svg) | Posting flow as a standalone SVG    |

## Design notes

**Money is integer minor units.** `Money` holds a `long`, so the rounding decision
happens exactly once — in `FromMajorUnits`, with an explicit
`MidpointRounding.ToEven` — instead of drifting with evaluation order.

**A posting is always two entries.** `Post` appends a matching debit and credit, and
there is no public API to append one. That is what makes `IsBalanced` an invariant
instead of a hope.

**The sign lives on the entry.** `Entry.SignedAmount` negates a debit, so no caller
branches on `EntryKind` to work out a sign. Doing that by hand is how balances drift.

**Domain errors are exceptions.** `LedgerException` covers what a caller could
reasonably get wrong — unknown account, duplicate account, non-positive posting,
currency mismatch. `Main` catches it and returns exit code 1, so a user error never
surfaces as a stack trace.
