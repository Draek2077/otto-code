---
title: Git providers
description: Save Git server accounts on a host, choose defaults, and use different accounts for individual projects.
nav: Git providers
order: 13
category: Git
---

# Git providers

Otto's pull-request features use your project's Git server. You can save several accounts on a host, choose a default for each server, and choose a different account for individual projects.

The Git remote identifies the provider: a repository on `github.com` uses GitHub and one on `bitbucket.org` uses Bitbucket Cloud. The account used for pull requests is separate from your Git commit identity and SSH keys. Otto keeps your existing Git commit, fetch and push setup.

## Connecting a provider

Open **Host settings → Workspaces → Git connections** and select **Add connection**. Choose the provider, enter a name such as Work or Personal, and enter the server hostname. **Save and set as host default** makes that account the default for projects using that server.

### GitHub

Choose **Existing GitHub CLI account** and enter the login name of an account already signed in on the host, or choose **API token**. The token form links to GitHub's token creation and permission instructions. Otto verifies the account and saves its credential securely on the host. Importing a CLI account leaves its globally active account unchanged. GitHub operations still require the GitHub CLI on the host.

### Bitbucket Cloud

Bitbucket Cloud uses an **Atlassian account email** and an **API token**:

1. Select **API token**, then use **Create a token and check permissions** to open your Atlassian account settings.
2. Enter your account email and paste the token. Give it access to the repositories and pull requests you need.
3. Save the connection. Otto checks the account before saving.

Saved connection tokens live in the host's credential vault. A project stores only its connection selection. Existing Atlassian settings remain available for Jira and for Bitbucket projects that use the existing host configuration.

### GitLab, Gitea, Forgejo and Codeberg

GitLab connections accept an API token and require `glab` on the host. Gitea, Forgejo and Codeberg connections use an existing named `tea` login on the host. Enter your server hostname for a self-hosted installation.

## Using another account for one project

Open **Project Settings → Git connections**. Each server offers **Use host default** and the accounts saved for that server. Choose an account or add a connection directly in the project. The choice applies to all of that project's worktrees, including worktrees outside its folder.

If a selected connection is removed or stops working, Otto asks you to choose or reconnect it. It does not silently switch to a different account. Use **Reconnect** in host settings to replace an expired credential. Background lookups never open a sign-in window or ask for credentials in a terminal.

This connection setup supports existing CLI logins and token entry. Browser OAuth sign-in is not available here yet. A successful account check confirms the identity; repository access still depends on that account's permissions.

## How a workspace picks its provider

The provider comes from the workspace's git remote:

- `github.com/…` → GitHub
- `bitbucket.org/…` → Bitbucket Cloud

Both HTTPS and SSH remotes (including scp-style `git@…` and SSH hostname aliases) are understood. Other Forge providers use their registered host detection or an explicitly configured connection.

For an unusual setup you can override the choice by adding `gitHosting.provider` to the repo's `otto.json`, but you'll rarely need to. The remote is almost always enough.

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
| Issues                                   |   ✓    | ✗ (teams use Jira) |
| Auto-merge / merge queue                 |   ✓    |         ✗          |
| Detailed check annotations               |   ✓    |         ✗          |

Bitbucket Cloud's native issue tracker is deprecated, so issue features are GitHub-only for now: most Bitbucket teams track issues in Jira. Auto-merge, merge queues, and check-run detail are genuinely GitHub capabilities and aren't emulated.

## Merging is checked before it happens

Whenever you merge a PR from Otto, the daemon re-checks the merge preconditions against the provider first. It confirms the PR is still open and mergeable before proceeding, rather than trusting a possibly-stale cached view. Merges only ever happen from an explicit action you take, never from background polling.

## Where next

- [Git worktrees](/docs/worktrees), check out a PR or a branch into an isolated working copy.
- [Workspaces](/docs/workspaces), the project and workspace model these features attach to.
- [Security](/docs/security), how Otto handles credentials and the daemon trust boundary.
