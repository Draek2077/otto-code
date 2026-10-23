# Otto Brain

Independent Otto-owned host package. Source workspace `@getpaseo/brain` publishes as
`@otto-code/brain`; the standalone executable is `otto-brain`. Follow the root rules.

Configuration and import boundaries must remain independent of Paseo. Imports and
help must not resolve a home, modify files, open sockets or launch processes. Only
explicit operations may resolve `$OTTO_HOME/otto-brain/`. Never exercise a real user
home or model in tests. Use isolated `.tmp/` fixtures and ephemeral loopback ports.

The current foundation provides configuration continuity and the host transport and
lifecycle. Model engines, acquisition, scheduling, operations, full CLI, plugins and
the Brain renderer are subsequent restoration checkpoints. Do not advertise an
unimplemented management capability. See `docs/otto-brain.md`.
