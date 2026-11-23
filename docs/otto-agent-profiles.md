# Profiles and Teams

In Host settings, **Agents** holds the Profile roster and Teams for that host. A Profile has a stable id, a human name, a provider, and optional model, permission mode, thinking option and provider features. Its identity includes roles, two chat spinner colors, a prompt, a spoken voice, and lines for joining, working, waiting for teammates and finishing.

A fresh host offers Atlas, Sage, Vera, Pixel, Dash and Sprocket in **The Otto Crew**. Select the Team in the sidebar to activate it. **Restore missing** in Host settings adds missing starter records by id and preserves edits to existing members. An explicitly empty roster stays empty across restarts.

## Choosing who works

The sidebar Team switcher changes the active Team on the selected host. A project can supply a default Team on workspace entry. Members are ordered. A new chat uses the first eligible Chatter in Team order. If the Team has none, it uses the last explicitly selected Chatter on this host, then the first available Chatter. With no eligible Profile it uses the ordinary model preferences. Changing an existing chat leaves new-chat preferences alone. The model picker shows Chatter members of the active Team alongside the ordinary provider models. Selecting a bare model explicitly removes the Profile binding. A live chat keeps its provider. Its current Profile remains visible when another Team becomes active.

The daemon resolves an explicitly selected Profile id and composes the Team instructions ahead of the member instructions. The chat keeps a snapshot. Editing a Team or renaming a Profile only affects subsequent selections. Changing instructions in an existing chat requires an idle resumable provider session. Otto uses the existing provider conversation for that change.

A Workflow review captures Team role assignments and their provider/model seats. A running Workflow uses its reviewed assignments for the conductor, workers and judges. A missing required role is reported before its chat starts. Without an active Team, explicit Workflow seats apply.

The `list_profiles` MCP tool lists the visible roster, roles and model selections. `create_agent` accepts the listed Profile id with its matching provider/model. Spoken lines and prompts stay out of the catalog result.

## Voice and authoring

The Profile editor can generate a prompt or a set of lines using the host's metadata-generation configuration. Generated text stays in the editor until the Profile is saved. Each moment accepts multiple editable lines. The host's speech configuration supplies voice choices. Cue playback follows the device's voice settings and skips an occupied player. Ordinary spoken replies can use the chat's assigned voice too. If that voice is unavailable on the host's configured speech provider and model, playback uses the host voice and speed.

The **Prefer Writer Profiles** setting gives available Writers priority for metadata generation. With an active Team, only its member Writers participate. The normal provider chain is still available.

## Profile memory

A named Profile carries lessons between chats on its host. In **Context → Memory**, select a Profile to see the brief for the current workspace, its estimated token count and the stored lessons. Add, edit, rescope or forget individual lessons here. Project lessons apply to their owning project. Global lessons apply across projects on that host. Choosing a Profile in the prospective Context report includes its brief in fixed tokens and working room. Inspecting a running chat uses its actual prepared request. **Remember lessons** in the Profile editor controls accrual and injection. Removing a Profile with lessons offers transfer, deletion or cancellation.

The Profile list shows how many lessons each Profile has. The daemon reads the original `profile-memory` directory in place. The shared agent tools `remember_lesson`, `review_lessons` and `revise_lesson` resolve the calling chat’s bound Profile. Repeated lessons reinforce the same entry within a scope. Up to 200 entries are retained per Profile. Fresh provider sessions use a 1,500-estimated-token budget to select lessons. When older lessons are omitted, the brief includes a short notice. An empty brief adds no prompt text.

## Artifact and Schedule model pickers

The Artifact model picker lists Artificers on its host. A new Artifact starts with the active Team’s eligible Artificer, then the last available named Artificer picked on this device for that host, then the first available Artificer. Picking the Team entry captures its member for this generation. The Artificer receives its instructions and the same project-scoped lesson brief shown in Context. A bare model or the host generation default is also available.

The new-agent Schedule picker uses the same role preference order and offers named Schedulers and **Team’s Scheduler**. A named selection follows that Profile. The Team selection resolves a member on every fire, so changing Teams can change who executes the next run. Review shows the current member and model. An unavailable selection stops before workspace or chat creation. Selecting a raw model clears the binding. Existing-chat Schedules continue targeting the chosen chat.

## Ownership

Paseo owns provider discovery, model selection, agent sessions and daemon config delivery. Otto extends these through identified code seams and optional protocol fields. Profile and Team records live on the owning daemon. Neither the client nor a Workflow writes a parallel roster. The 0.9 import preserves existing ids, additional Profile fields and the original configuration backup.
