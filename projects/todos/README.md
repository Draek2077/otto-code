# TODOs — pull-off cleanup tasks

Small, self-contained leftovers extracted from projects that are **>80% shipped**. Each file is one
independently-pullable task with enough context to finish without re-reading the parent charter. When
you complete one, delete its file. When this folder is empty, delete the folder and remove its row
from the CLAUDE.md Projects table.

These are the _small_ tails only. Feature-scale remainders (e.g. agent-orchestration's budget caps +
composer-as-default UX, git-hosting's additional providers, text-editor's gutter touch-selection)
stay tracked in their own charters — they are not quick cleanups.

| Task                                                                         | From                                 | Size   | Touches                                           |
| ---------------------------------------------------------------------------- | ------------------------------------ | ------ | ------------------------------------------------- |
| [schedule-form-personality-binding.md](schedule-form-personality-binding.md) | agent-personalities (Step 5b-client) | S–M    | app schedule form; **has a product decision**     |
| [agent-teams-themed-avatars.md](agent-teams-themed-avatars.md)               | agent-teams (Step 7)                 | M      | image assets + teams editor; schema already ready |
| [vertical-tabs-rail-polish.md](vertical-tabs-rail-polish.md)                 | vertical-tabs (Step 8)               | S each | vertical tab rail styling/DnD/i18n                |
| [unattended-denial-promote.md](unattended-denial-promote.md)                 | safe-unattended (Phase 3 finish)     | S      | daemon; closes a `TODO(...)` already in code      |
| [editor-go-to-definition.md](editor-go-to-definition.md)                     | text-editor (deferred nav)           | M      | editor client bridge; daemon side already shipped |

Convention reference: [CLAUDE.md](../../CLAUDE.md) → "Projects" and the protocol/compat rules.
