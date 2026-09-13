---
title: Otto plugin documentation
description: Choose the current plugin API guide or historical migration reference.
nav: Versions
order: 44
category: Plugins
---

# Otto plugin documentation

Otto integrates the stable Paseo v0.8 plugin API. Plugins use separate client and
server entries; shared contracts stay in their own directory. The API remains
experimental and may change between releases.

## [Paseo v0.8 API in Otto (current)](/docs/plugins/v0.8)

Build, install and update a trusted plugin using Otto's SDK and CLI. Existing
mixed-entry plugins need the [migration guide](/docs/plugins/v0.8/migration).
The Paseo compatibility range in the manifest is separate from Otto's package version.

## [Paseo v0.7 API (historical)](/docs/plugins/v0.7/reference)

Use this reference to understand the old mixed-entry contract while migrating.
Its imports and root `index.ts` are not the current Otto runtime contract.
