# Fresh-design security review and decision record

Date: 2026-11-20. Status: **design review, not implementation verification**. Independent reviews were requested from GPT-6.2 Sol, Opus 5.5 and Gemini 4 Neon, all with high reasoning settings. This document consolidates their findings and the primary agent's assessment against the [fresh design](fresh-design.md), including website create-only input and read-only machine inventory.

No application code, deployment or data deletion was performed by these reviews. The FRESH cases in [feature.md](feature.md) remain planned and unrun. Reviewer suggestions are not automatically accepted architecture or new user requirements.

## 1. Overall assessment

The confirmed product intent is workable, but the encryption/writer trust and administrative authorization are not ready for implementation. A targeted specification pass is needed. Existing compatibility and migration are not blockers because the user explicitly excluded them.

The largest issue is a genuine trust-boundary conflict: an ordinary hosted page needs a way to create values without learning the account vault key, and a fresh reader must not mistake server-created values for trusted-client writes. Public-key encryption alone solves the first problem, not the second. The choice of how website-created values become trusted must precede the final cryptographic profile.

## 2. Prioritized findings

### R1. Website creation reopens encryption and writer authenticity — blocking

The [symmetric candidate](fresh-design.md#7-authenticated-record-encryption) was proposed for local-only input. A hosted page would need its secret key to encrypt, exposing every account value to malicious page code. Do not give the website that key or request the vault password there.

Public-key recipient encryption can keep the decryption key off the page, but anybody with the public key can create ciphertext. An API attacker could hide a trusted record and serve a newly constructed website-class record for the same name. Fresh machines and cloud-function cold starts have no prior name/version history to reject that downgrade.

The viable product choices are:

1. Website submissions remain pending until the user verifies the exact name/value in an independently trusted local client. Normal reads accept only authenticated activated values.
2. Website submissions become immediately usable, accepting the weaker malicious-server authenticity boundary for website-origin records, especially on fresh readers.
3. Add an independently installed trusted entry/signing component to the website-initiated flow, so the hosted page is not the sole source of authoring authority.

A passkey/user-presence prompt can constrain when a browser signs; it does not make the server-supplied JavaScript or displayed transaction content independently trustworthy. A local signer that blindly signs server-provided ciphertext has the same issue. Do not present either as a complete solution without defining trusted input verification.

Global latest-state/name-ownership proofs are distinct from writer signatures. Signed data can still be replayed or hidden. Any authenticity exception must be explicit in the SDK policy and authenticated record format, not silently downgraded on a fresh client.

### R2. Create-only needs real authorization boundaries — blocking

Hiding update/delete buttons is insufficient. A website session must not call native administrative endpoints, silently issue itself equivalent administrative authority, delete/rename/reassign a project to remove its values, or reuse a create endpoint as upsert.

Specify distinct website-create, runtime-read, native-administration and custody-change authority. Native administrative capabilities must require a trusted local authority the website cannot exercise merely by holding its ordinary session. Reuse account identity where useful; do not equate identity with identical operation permission.

Engineering requirements:

- Pure atomic insertion with a shared canonical-name uniqueness constraint, never check-then-overwrite or upsert.
- Define case, whitespace and Unicode behavior consistently for website, SDK, API and database.
- Bind idempotency to actor, operation, context and request digest. A retry after a successful create/deletion must not overwrite or resurrect a value.
- Restrict destructive project/cascade/rename/reset paths consistently with secret permissions.
- Define deletion, tombstones, name reuse and revision/incarnation semantics together.
- Check authority and active write epoch at commit, and commit safe audit events atomically.

The exact headless administrative credential and recovery model still needs the user decisions in section 4.

### R3. Machine inventory is a registration view, not a census of key copies — high

Define an entry as a registered installation or logical deployment, scoped by origin/account. Persist its stable ID at provisioning. Reboots, service-key changes, container replacements and function cold starts should not create a new entry each time.

Separate registered count from recently observed activity. Hostnames/labels are untrusted display data; last contact is server-observed API activity, not proof a key is still present. Offline copies and cloned identities can be invisible or share an entry. No website management/control operation is required by the user.

If the UI claims successful key provisioning rather than self-reported registration, define a suitable post-provision proof. A service key plus a newly generated installation key does not by itself prove vault-key possession. Do not add a registration/approval availability gate to normal reads just to populate the list. Bound registration and last-seen write amplification, tenant visibility and stale-entry retention.

### R4. Password-wrapper download broadens a leaked service key's exposure — high

Password-based restoration and account-wide decryption were explicitly accepted. The additional issue is that any narrow runtime token currently downloads the account-wide offline password-guessing target. Already provisioned runtimes only need the encrypted operational keyring, not the password wrapper.

Prefer separate bootstrap and operational-refresh endpoints. The user must decide whether bootstrap requires management login/an explicitly enabled service-key capability, or remains available to every read credential. Both can preserve promptless refresh after bootstrap. Rate limits help online abuse but do not stop offline guessing once a wrapper is captured. A vetted bounded KDF and strong password policy remain necessary in either case.

### R5. Transfer retry needs proof beyond an attempt ID — high

The first holder of the complete code is an accepted bearer-capability boundary. A public/inspectable attempt ID does not bind retries or acknowledgement to one receiver.

Generate and persist an independent recipient claim-session secret or equivalent proof before claiming. Bind successful claim state to that proof, require it for bounded resumption and acknowledgement, and acknowledge only after durable authenticated installation. Bind origin/account/vault, transfer ID, format and expiry into the encrypted package. Explicitly specify cancellation/expiry for pending versus claimed-but-unacknowledged states.

The user must choose whether an own-account service credential is also required to claim. Include operational sync authority explicitly if transfer is meant to support future automatic sync; do not use vague optional wording. Never include source service keys, passwords or administrative sessions by default.

Single-recipient/expiry enforcement applies to the honest live relay. A malicious relay can ignore those state rules, and captured encrypted material plus the complete code remains decryptable offline. Trusted delivery of the code or an independently known account/vault anchor establishes the sender/account expectation; self-consistent encryption alone does not authenticate a stranger's claimed account identity.

### R6. Reset, rotation and stale key epochs can expose future values — high

Keep password-wrapper and operational-keyring revisions independent for routine updates, but change their common sync-key epoch atomically. Reject concurrent updates based on the wrong epoch/revision. Otherwise a password reset racing with sync-authority rotation can leave restoration material that cannot decrypt the active keyring.

Remote wrapper replacement needs narrowly scoped management authorization and proof of continuity tied to the current vault/sync authority, expected wrapper digest and revisions. OS reauthentication is a trusted-client action, not proof the server can infer from a flag. Define a real headless operator mechanism.

A fresh client can be served an old password wrapper/keyring. If a compromised old key is accepted for new writes, the replay leaks future data, not merely old values. Compromise response should replace the vault and sync authority, change the vault password, securely re-provision retained clients, and reject new writes under retired epochs. Transfer packages should carry the source's observed revision/epoch floor. Stateless clients still lack an independent global freshness witness.

### R7. Additional writer keys must actually be separated from runtime sync authority — high if adopted

Separate administrative signing keys can distinguish trusted writers from decryption-only workloads. Their public verifiers must be anchored through authenticated setup/sync/transfer, rather than accepted from a replaceable API response.

Omitting a private signing key from a deployment export is insufficient if the same runtime sync key can decrypt a server keyring containing it. Administrative private material needs a separately protected package/authority that ordinary read runtimes cannot decrypt. Define read versus administrative transfer/bootstrap profiles explicitly. This adds internal cryptographic material, not another user-managed password for normal reads.

Writer recovery must also be designed: full administrative restoration after all admin devices are lost requires appropriately encrypted recoverable administrative material plus account-management authorization. A read service key, read sync key or normal key-transfer code must not implicitly promote a runtime into administration.

### R8. Platform and request-context contracts need concrete specifications — engineering

Finalize and verify native custody adapters, secret-safe helper IPC, deployment mount validation and packaging. Do not infer support from old desktop permission checks, which may reject legitimate mounted secrets. Avoid secret-bearing process arguments, PowerShell command text and routine tracing.

Pin service origin/account from selected configuration/credential; authenticate the full credential and its account binding; scope caches per client/origin/account/vault/key. Construct expected request context from the caller's request and pinned identity, not entirely from response metadata. Keep authorization failures distinct from missing values. Bound safe-read retries and require ordinary API authorization for each normal online read.

Fix nonce/usage and KDF parameter floors/ceilings through a maintained reviewed profile and interoperability tests. Do not adopt an unreviewed derivation merely because a reviewer claims it supplies key commitment or solves every nonce problem. Reusing old code is optional; its tests are not evidence for a new format.

## 3. Accepted tradeoffs and review qualifications

- Account-wide key copies, intentional plaintext retrieval, trusted OS/deployment operators and password-based restoration remain accepted choices. Code redemption now additionally requires the recipient's own same-account service key; it remains a bearer-code mechanism rather than physical-device attestation.
- Symmetric key holders being mathematically able to encrypt was stated in the previous candidate. Separating writer authority is a distinct strengthening; do not misdescribe the accepted API-only scope boundary as cryptographic per-project/read-only isolation.
- General replay/omission on fresh clients was disclosed. Key-epoch rollback followed by new writes needs separate attention because it can expose future plaintext.
- FRESH-43 through FRESH-47 were added during the reviews. A report saying no website/inventory cases exist is stale on that point. Those cases are still planned, not coverage.
- The amendment marked local-only clauses as superseded. Active text now reflects pending website submissions, trusted local signed activation and role-separated synchronization/restoration. The proposed public-key/signature profile is not yet a tested or audited implementation.
- These are design risks and incomplete contracts, not evidence of an exploited vulnerability or a completed penetration test.

## 4. User decisions confirmed after review

| Decision | User's selected policy |
| --- | --- |
| Website value trust | Keep pending until the user verifies the exact name/value in a trusted local client; preserve strong forgery protection |
| Password-wrapper bootstrap | Management login or service keys explicitly allowed to bootstrap; ordinary runtime keys cannot fetch the wrapper |
| Machine inventory | Registered installations and logical deployments with last-seen and active/inactive status |
| Transfer recipient | Require both the complete transfer code and the recipient's own valid same-account service key |
| Headless administration | Support separately provisioned administrative credentials and local write authority for native SDK CRUD |
| Loss of every admin machine | Account login plus vault password restores full administrative writer authority and decryption |
| Forgotten password, only read-only keys survive | Administrative authority is unrecoverable; no login/support/read-key promotion or replacement bypass |

All six answers and the follow-up edge-case answer are reflected in the revised draft. No approval prompt is added to ordinary reads. Private writer authority must be protected separately from runtime sync, and the mutable runtime keyring must itself be signed against an independently bootstrap-pinned writer root.

For the follow-up case, already configured reads may continue while runtime material and API authorization remain usable. That is existing access, not restoration of the missing signer or administrative control. Neither read-key possession nor account login may replace the lost writer authority when the vault password is also unavailable.

## 5. Specification and verification work after decisions

Resolve the selected write model, authority bootstrap/renewal, role-separated synchronization, receiver claim proof, canonical namespace/tombstones, active-epoch enforcement and inventory lifecycle. Reconcile the format and API contracts with the public SDK surface before coding.

Extend the planned FRESH cases with actual API/installed-client and disposable PostgreSQL coverage for hostile website-origin substitution, cold-start provenance downgrade, cross-route/cascade privilege bypass, concurrent creates, replay after delete/recreate, bootstrap wrapper scope, concurrent reset/epoch rotation, receiver-session hijack, admin-keyring exposure, and stable installation/deployment counting. Document which replay and offline-code-capture cases remain accepted limitations.
