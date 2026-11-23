# Shared host integration accounts

`otto-integrations` contributes the host's **Atlassian account**, **Bitbucket
connections** and **Connectors** settings pages.
The entry appears under the existing host Plugins settings page. Paseo's
`PageLayout` owns its scroll area, gutters and centered content frame. Registered
screen titles own the page heading; internal plugin identifiers are not headings.

The built-in uses the existing authenticated plugin RPC envelope. Its canonical
client-safe contracts are exported by `@getpaseo/plugin/otto/atlassian-settings`.
The selected daemon's `IntegrationAccountRpc` validates the host identity and
delegates to `AtlassianAccountService`. The plugin has no credential store,
private daemon import, independent transport or plugin-global account settings.

## Storage and credential ownership

The daemon's `FileIntegrationRegistry` stores nonsecret account metadata in
`$OTTO_HOME/integrations/accounts.json`. A shared queue, originating revision and
atomic publication protect cooperating writers. Unknown registry and connection
metadata survive edits. Corrupt data is refused and left unchanged. External
editors do not share the queue; the final byte comparison is not a cross-process
transaction.

`CredentialVault` stores secrets through the pinned `@napi-rs/keyring` backend.
There is no plaintext fallback. Construction and native binding loading do not
read or write the keyring. The vault preserves Otto 0.9's service/account identity
and reads its single-entry and chunked formats without migration. New credential
identities are immutable; bounded Unicode chunks are published through a final
manifest pointer. Rotation allocates a new identity before metadata publication.
A proven metadata conflict discards only the uncommitted new credential. An
unknown publication outcome retains it for reconciliation. A successful rotation
or removal retires the previously referenced OS credential.

The account form sends explicit Keep, Replace or Remove intent. Blank replacement
never means removal. An email change cannot reuse a different account's old
token. Existing secrets never return to the renderer or metadata file. Temporary
replacement text is cleared after its own accepted save or closing the form;
newer replacement edits survive an older acknowledgment. Unknown/conflict outcomes
block another save until explicit reload. Proven validation rejection permits a
new explicit save against the same originating revision.

Preserved `gitHosting.providers.atlassian` is read as one identity; the old
Bitbucket slot is consulted only when the Atlassian slot is absent. Merely reading
or resolving it does not rewrite config or import the secret. Explicit saving can
import that credential into the vault. Explicit removal disables legacy fallback
without deleting the original preserved configuration.

## Atlassian requests

The shared server-only HTTP adapter supports ordinary API tokens against the
configured Atlassian Cloud site and scoped API tokens against
`https://api.atlassian.com/ex/jira/{cloudId}`. Both use the account's Basic-auth
identity, following [Atlassian's API-token contract](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/).
Site and gateway routing are explicit. Credentials do not come from board RPCs.

Only supported relative Jira REST paths are accepted. Responses and duration are
bounded; redirects are refused and writes are never automatically retried. Safe
errors distinguish unavailable credentials, scope/permission failures and unknown
write outcomes without returning raw vendor/native errors. Jira uses this shared
account. [Bitbucket connections](otto-bitbucket.md) documents its separate named
accounts, project selection and native Cloud adapter.

## Verification boundary

[Connectors](otto-connectors.md) reuse this host's lazy vault and authorization
registry. Their OAuth grants have independent connection revisions, so token
renewal does not invalidate account settings. The original publisher identities,
callbacks, hosted bindings and legacy credential tuples are preserved.

Focused fixtures exercise metadata preservation, stale revisions, secret
redaction, credential rotation/removal, unknown publication outcomes, legacy
formats, inert bundle registration and draft lifecycle. These use isolated files,
injected HTTP and an in-memory keyring. They do not establish live Atlassian or
native keyring write acceptance. CI loads the native binding without touching
credential entries. No account probe occurs on registration or settings reads.
