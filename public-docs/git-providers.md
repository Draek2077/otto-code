---
title: Git providers
description: Connect GitHub and Bitbucket Cloud once per host — each workspace picks the right one from its git remote for pull requests, issues, checks, and merges.
nav: Git providers
order: 13
category: Git
---

# Git providers

Otto's pull-request features — the PR panel, checks, issue and PR search, attaching a PR or issue to a prompt, checking out a PR into a worktree, and merging — work against both **GitHub** and **Bitbucket Cloud**. You connect each provider once per host, and every workspace automatically uses whichever one matches its git remote.

You don't choose a provider per project. A repo on `github.com` uses GitHub; a repo on `bitbucket.org` uses Bitbucket Cloud. Open a Bitbucket-remote project and all the PR and issue features switch over on their own.

## Connecting a provider

Open **Host settings**, go to the **Workspaces** page, and find the **Git providers** section.

### GitHub

GitHub needs no credentials stored in Otto — it uses the [GitHub CLI](https://cli.github.com/) (`gh`) that's already installed and authenticated on your machine. The GitHub card is just a **Check connection** button that confirms `gh` is signed in. If it isn't, run `gh auth login` in a terminal.

### Bitbucket Cloud

Bitbucket Cloud uses an **Atlassian account email** and an **API token**:

1. Create an API token in your Atlassian account settings.
2. In the Bitbucket Cloud card, enter your account email and paste the token.
3. Use **Check connection** to confirm it works.

You enter this once per host, not once per repo. The token is stored only in the daemon's private config file (`$OTTO_HOME/config.json`), never in a repo's `otto.json` and never in git. The connection is HTTPS-only, the credential is sent per request, and it's kept out of logs and error messages.

## How a workspace picks its provider

The provider comes from the workspace's git remote:

- `github.com/…` → GitHub
- `bitbucket.org/…` → Bitbucket Cloud

Both HTTPS and SSH remotes (including scp-style `git@…`) are understood. If a remote matches neither host, Otto defaults to GitHub.

For an unusual setup you can override the choice by adding `gitHosting.provider` to the repo's `otto.json`, but you'll rarely need to — the remote is almost always enough.

## What works on each provider

Otto never fakes a feature a provider doesn't have. Each provider advertises what it supports, and the app only shows the actions that actually work there.

| Feature                                  | GitHub |  Bitbucket Cloud   |
| ---------------------------------------- | :----: | :----------------: |
| Pull requests: list, view, create, merge |   ✓    |         ✓          |
| PR status and checks                     |   ✓    |         ✓          |
| PR timeline (comments, reviews)          |   ✓    |         ✓          |
| Draft PRs and review decisions           |   ✓    |         ✓          |
| Check out a PR into a worktree           |   ✓    |         ✓          |
| Attach a PR to a prompt                  |   ✓    |         ✓          |
| Issues                                   |   ✓    | — (teams use Jira) |
| Auto-merge / merge queue                 |   ✓    |         —          |
| Detailed check annotations               |   ✓    |         —          |

Bitbucket Cloud's native issue tracker is deprecated, so issue features are GitHub-only for now — most Bitbucket teams track issues in Jira. Auto-merge, merge queues, and check-run detail are genuinely GitHub capabilities and aren't emulated.

## Merging is checked before it happens

Whenever you merge a PR from Otto, the daemon re-checks the merge preconditions against the provider first — it confirms the PR is still open and mergeable before proceeding, rather than trusting a possibly-stale cached view. Merges only ever happen from an explicit action you take, never from background polling.

## Where next

- [Git worktrees](/docs/worktrees), check out a PR or a branch into an isolated working copy.
- [Workspaces](/docs/workspaces), the project and workspace model these features attach to.
- [Security](/docs/security), how Otto handles credentials and the daemon trust boundary.
