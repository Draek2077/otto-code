# Otto Brain

Independent Otto-owned host package. Source workspace `@getpaseo/brain` publishes as
`@otto-code/brain`; the standalone executable is `otto-brain`. Follow the root rules.

Configuration and import boundaries must remain independent of Paseo. Imports and
help must not resolve a home, modify files, open sockets or launch processes. Only
explicit operations may resolve `$OTTO_HOME/otto-brain/`. Never exercise a real user
home or model in tests. Use isolated `.tmp/` fixtures and ephemeral loopback ports.

The package provides configuration continuity, host transport, explicit llama.cpp
process ownership, runtime acquisition and model inventory/download libraries.
Scheduling and process-pool libraries are present. Host integration, operations,
full CLI, plugins and the Brain renderer remain restoration work. Do not advertise an unimplemented management capability. Native
helpers and model processes must have bounded readiness/probe and shutdown paths.
See `docs/otto-brain.md`.
