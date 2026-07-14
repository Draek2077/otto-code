# TODO: Themed avatar image set for agent teams

**From:** agent-teams, Step 7 (the only remaining item; steps 1–6 shipped and committed — durable
architecture is in [docs/agent-personalities.md](../../docs/agent-personalities.md) and the
[agent-teams charter](../agent-teams/agent-teams.md)). **Size:** medium (needs image assets).

## Goal

Give teams (and, by extension, the team avatar surfaces) a set of **themed avatar images** the user
can pick from, instead of only a solid color swatch.

## Current state (verified)

The schema is **already reserved and forward-compatible** — no protocol work needed:

- `packages/protocol/src/messages.ts` (~L354–384): `AgentTeamAvatarSchema = { color?, imageId? }`.
  The comment already states the contract: _"`imageId` is reserved for the future themed avatar set —
  when present it wins over color, and color stays the fallback so an old client that doesn't know
  `imageId` keeps rendering the swatch."_ Plain strings for forward compat.

So today `avatar.color` is set and rendered; `avatar.imageId` is accepted but nothing writes it and
nothing renders it.

## Task

1. **Produce the asset set** — ~2 dozen themed avatar images (the charter's estimate). Vendor them
   as app assets (follow the existing image-asset convention in `packages/app`), keyed by a stable
   string id. Keep them small and theme-consistent (they pair with the personality identity system).
2. **Render `imageId` when present** — in every place a team avatar renders (team cards, the
   `active-team-switcher.tsx`, the teams editor `agent-teams-section.tsx`, and any personality/team
   avatar component), resolve `imageId` → image and render it, falling back to the `color` swatch when
   `imageId` is absent or unknown. Keep the "imageId wins over color" rule from the schema comment.
3. **Add a picker grid** — in the teams editor (`agent-teams-section.tsx`), a small grid of the
   themed images so the user can set `avatar.imageId` on a team (writing through the existing
   daemon-config patch RPC that already persists `agentTeams`). Clearing it falls back to color.
4. Optionally extend the same image set to personalities if their avatar surface wants it (out of
   scope unless trivial — teams is the ask).

## Verify

Pick an image for a team in the editor → the card/switcher render the image, config persists
`avatar.imageId`, and a client that predates the asset (unknown id) still shows the color swatch.

## Compat

None needed — `imageId` is already an optional additive leaf and unknown ids degrade to color. No
`features.*` flag required (it's config data an old client simply ignores).
