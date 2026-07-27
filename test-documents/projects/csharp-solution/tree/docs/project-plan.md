# Project plan — Otto.Ledger

## Goal

A double-entry ledger small enough to read in one sitting and strict enough that a
lost transaction is impossible rather than unlikely.

## Milestones

| # | Milestone | State | Exit criterion |
| - | --------- | ----- | -------------- |
| 1 | Money type | ✅ Done | Integer minor units; rounding happens once, in `FromMajorUnits` |
| 2 | Accounts and entries | ✅ Done | `Account` rejects a blank id; `Entry.SignedAmount` owns the sign |
| 3 | Balanced posting | ✅ Done | `Post` appends a debit and a credit atomically; no public single-entry API |
| 4 | Trial balance CLI | ✅ Done | `dotnet run` prints per-account balances and a balanced verdict |
| 5 | Overdrawn report | 🚧 In progress | `--overdrawn` exits 1 when any account is negative |
| 6 | Running balances | ⬜ Not started | `BalanceOf` is O(1); `Overdrawn()` stops being O(accounts × entries) |
| 7 | Persistence | ⬜ Not started | Ledger round-trips to disk without losing entry order |

## Out of scope

- Multi-currency conversion. Postings across currencies are rejected, not converted.
  A rate source is a different project with a different failure mode.
- Reversals and adjustments. Append-only for now; a correction is a new posting.
- Concurrency. `GeneralLedger` is not thread-safe and does not pretend to be.

## Risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| `Overdrawn()` is quadratic | Slows past a few thousand entries | Milestone 6 |
| No persistence | Every run reseeds a demo ledger | Milestone 7 |
| `long` minor units overflow | Silent corruption above ~92 quadrillion | Accepted; document the ceiling |
