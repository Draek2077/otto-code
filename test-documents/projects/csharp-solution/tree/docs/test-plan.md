# Test plan — Otto.Ledger

## What we are proving

That the ledger invariant holds: for every currency, debits and credits sum to zero.
Everything else is in service of that.

## Layers

| Layer | Scope | Where |
| ----- | ----- | ----- |
| Unit | `Money` arithmetic, `Entry.SignedAmount`, `Account` validation | `Otto.Ledger.Core` |
| Invariant | `IsBalanced` after arbitrary posting sequences | `Otto.Ledger.Core` |
| CLI | Exit codes and stderr for domain errors | `Otto.Ledger.Cli` |

## Cases

### Money

- [x] `FromMajorUnits` rounds half-to-even, not half-away-from-zero
- [x] `+` and `-` reject a currency mismatch
- [x] Unary `-` negates minor units and preserves currency
- [ ] `ToString` formats with a thousands separator and two decimals

### Posting

- [x] `Post` rejects a zero or negative amount
- [x] `Post` rejects an unknown account on either side
- [x] `Post` rejects a cross-currency transfer
- [x] A posting appends exactly two entries
- [ ] `IsBalanced` stays true across a randomized posting sequence (property test)

### Balances

- [x] `BalanceOf` nets debits against credits
- [x] `Overdrawn` reports an account driven negative
- [ ] `Overdrawn` is empty for a ledger with no postings

### CLI

- [x] Exit 0 when the ledger balances
- [ ] Exit 1 and a stderr message for a `LedgerException`
- [ ] `--overdrawn` exits 1 when an account is negative

## Known gaps

No test project yet — the cases above are verified by running the CLI. Adding one
means a NuGet package, which the fixture avoids on purpose. See
[test-documents/projects/README.md](../../README.md) rule 3.
