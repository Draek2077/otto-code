# Host activity and usage log

Open **Usage** and select the host whose activity you want to see. **Providers** shows provider quota reports. **Activity** shows local counts and measured usage by period. **Log** pages through recent usage with reported token counts, cached inputs, and cost where available. These are host records, separate from a provider account's quota or invoice.

The daemon retains the version 1 `activity-stats.json` and `usage-log.json` formats. Totals accumulate across the lifetime of the host. Daily counts retain 35 local calendar days, and itemized usage retains 30 days. **Reset activity** clears both files after confirmation.

Activity records accepted live operations. It does not replay transcripts or reconstruct missing prices. OpenCode's cumulative counters contribute a measured interval for each locally dispatched turn. Native child and compaction usage require a separate provider measurement for attribution.
