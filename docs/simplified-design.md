# Simplified Keyman design decisions

Implementation update (2026-11-20): the fresh alpha source now exists independently of the earlier release. See [the fresh guide](fresh-quickstart.md) and [test record](fresh-testing.md); proposed APIs below may be superseded by the tested implementation. Native Windows/macOS and live browser/deployment qualification remain open.


Status: accepted replacement direction, implemented experimentally in this standalone repository, with Vercel/Neon deployed and targeted acceptance recorded; see [live-setup.md](live-setup.md). The earlier application remains in the separate [Keyman repository](https://github.com/07rjain/keyman). This decision record describes the product boundary; [security.md](security.md) defines the implemented profile and [testing.md](testing.md) records verification limits. Passman client archives are distributed through GitHub Releases; npm-registry publication remains deferred.

## From-scratch direction — confirmed scope, draft implementation

Latest user decisions: website submissions remain pending until exact name/value verification in a trusted local client; website update/overwrite/delete/activation is forbidden. Administrative CLI/SDK may create/activate/update/delete, including headless workloads with separate administrative credentials and local write authority. The read-only account inventory counts registered installations and logical deployments with last-seen/active status. See [the revised draft](fresh-design.md) and [security review](fresh-design-security-review.md).

The [fresh design draft](fresh-design.md), confirmed product choices dated 2026-11-20 and [PRD](PRD.md) supersede the 2026-11-19 redesign proposal and conflicting decisions below. Start without legacy compatibility or migrations. Use an account-wide versioned vault key, read-only scoped service keys with optional expiry, protected automatic local retrieval and intentional plaintext access. Support the JavaScript/TypeScript SDK and CLI on desktop/headless Windows/Linux/macOS, containers and ordinary Node.js cloud functions.

Automatically synchronize encrypted runtime material; password bootstrap requires management login or explicitly enabled service credentials, while ordinary runtime keys can refresh only their encrypted operational keyring. Full administrative restoration requires account login plus the vault password and a separately encrypted administrative package. If that password is forgotten and only read-only keys survive, administrative authority is unrecoverable, with no login/support/read-key replacement bypass; existing authorized reads may continue. The proposed profile uses public-recipient encryption, private administrative signing authority absent from runtime sync, and a signed keyring rooted in a bootstrap-pinned public verifier. Website entries never become default-readable without trusted local activation. Copied decryption keys cover every account project regardless of API scope. Formats/adapters remain draft and unimplemented.

Each account has one active decryption key whose copies are identical across machines. Several accounts may coexist locally: the service credential identifies the account, and the SDK automatically chooses that account's vault/key version using an origin/account/vault/key namespace. No project-name guessing, cross-account key trial or last-used-key fallback is allowed. Explicit rotation changes a key version; ordinary synchronization and service-key replacement do not.

SDK key transfer uses a long high-entropy expiring code plus the recipient's own same-account service key. One recipient claim may resume only with independently persisted receiver proof. Include authenticated account/vault details, identical decryption material, runtime sync authority and pinned writer public verifier; omit source credentials and private signing authority. Short-code alternatives are excluded. Exact encoding and relay state details remain engineering proposals.

The remaining sections describe the existing implementation or superseded decisions. Their manual unlock, HPKE/browser input, immutable key, no-recovery, old-device-transfer and migration rules do not constrain the replacement.

## Core model

- Clerk authenticates people and authorizes account management.
- A trusted local setup command generates a vault encryption key pair. The private key stays in a passphrase-encrypted local file; the public key is registered with the account. OIDC identity and encryption keys are separate concepts.
- Secret names are readable metadata. Values are encrypted before upload and decrypted locally. Use an established hybrid-encryption implementation; internal ephemeral data keys are managed automatically, not presented as additional user credentials.
- Projects organize names and lookups; they are not separate cryptographic trust domains. Account isolation and explicit API authorization remain mandatory. Prefer unambiguous project/name arguments over parsing arbitrary dotted strings.
- Losing every usable copy of the required private key makes the affected values unrecoverable. No account-only reset, support escrow or recovery kit is planned for this simpler version.
- The current implementation has no multi-machine key transfer or private-key export/sharing. The confirmed redesign adds only deliberate human-approved workload provisioning; general email/website transfer and independent device identities remain deferred. A fresh key pair on another machine cannot decrypt old records automatically. Sharing one private key also shares decryption authority and cannot provide independent cryptographic device revocation.

The initial implementation has one immutable vault public key per account, bound application-managed setup approval, and the HPKE/context profile in [security.md](security.md). The encryption key is not reused for signing. No old-application data migration or private-key transfer is implemented.

## Input paths and write authority

The CLI and separately exported administrative `prepareEnvImport` also support a bounded `.env` import. Parsing and encryption stay local; metadata context and encrypted entries use separate endpoints. A single transaction validates every selected revision and commits the whole batch with its audit event. Runtime `KeymanClient`/read credentials remain read-only. There is no automatic mutation retry or persisted idempotency receipt; a lost commit response requires metadata inspection before a deliberate new attempt. See [the format and failure contract](env-import.md).

The preferred input path is a trusted local CLI/administrative library operation: accept the name/value locally, encrypt the value locally using the selected vault public key and upload only its ciphertext and public metadata. Existing CLI management and runtime application access are different permission classes.

An optional hosted form may encrypt values in the browser using the public key before upload. It must explain that the plaintext is accessible to that page's scripts before encryption. A compromised website can capture new input or substitute a public key; Web Crypto does not remove that application trust boundary. See [W3C security considerations](https://www.w3.org/TR/webcrypto/#security-considerations). Never request the vault private key in the hosted form to implement ordinary additions or replacements.

Local administrative upload is the recommended input experience; ordinary agent/runtime credentials remain read-only. CLI `put` and the separately exported `uploadValue` helper require short-lived upload authorization. Broader unattended SDK creation/update/deletion and a hosted-page-to-local-port bridge stay on the future TODO list. The runtime `KeymanClient` exposes no mutation method; read credentials never implicitly gain write permission.

After manual local unlock, interactive CLI `put` may start the existing browser approval to renew missing/expired upload authorization before secret input. This requires the same fingerprint/code and human approval; it never replaces the vault key, account or origin. Noninteractive `put` fails before reading a value and directs the user to `passman login`. Runtime SDK calls and `uploadValue` never start browser approval. The 20-minute authorization lifetime is unchanged.

The normal service must not receive provider plaintext through supported local upload/retrieval paths. Optional browser input supports a narrower claim: encryption happens before the normal upload, but confidentiality of newly entered values does not survive malicious hosted JavaScript. This limitation does not allow private keys or provider values into server logs, telemetry or configuration.

## Accepted service authentication change

The replacement may use ordinary high-entropy read-only bearer service credentials, with expiry, revocation and server-side hash storage. The usable credential is displayed once at issuance and is received by the running API when used over HTTPS. Hash storage protects the stored copy; it does not hide live credentials from the API process. Credentials and authorization headers must be redacted from logs and errors.

This deliberately relaxes the earlier requirement that even a usable Keyman service credential must never reach the server. It does not permit server-held vault private keys or provider-value decryption. A stolen read credential alone permits authorized ciphertext/metadata retrieval, not decryption without the corresponding private material. A compromise that also obtains the client private key has a different impact.

No bearer fallback has been added to the existing dual-proof API. Replacing it requires explicit versioned implementation, client compatibility, migration and tests. Preserve existing identities and ciphertext; do not generate new random keys and label that a recovery or migration of old records.

## Programmatic use without exposing secrets to the model

The SDK must support programmatic search and retrieval with typed, redacted failure behavior. Metadata-only lookup may return permitted names/IDs or a missing result. Retrieval returns decrypted plaintext to the authorized local application. The MVP implements `search`, metadata-only `hasSecret`, and `getSecret`, with redacted `KeymanError.code` failures. See [testing.md](testing.md) for the interface. The earlier SDK is a separate implementation.

For an agent integration, expose a task-specific tool rather than a tool that returns a raw credential. A trusted local handler obtains the permitted key, calls the approved provider or performs the approved operation, and returns only allowed task output/status. Secret values, service credentials, authentication headers, stack traces and sensitive provider errors must not enter model messages, tool results, logs or tracing. Do not use an arbitrary destination URL or arbitrary callback controlled by the model as the presumed isolation boundary.

This distinguishes three actors: the model receives task output; the trusted executor receives/uses the plaintext key; the Keyman API returns ciphertext. A generic `getSecret` call does not by itself guarantee that a key stays hidden from the model. An agent with arbitrary code execution, access to the same vault credentials or equivalent OS permissions can print/copy the returned value. Stronger protection requires restricting execution/capabilities outside the model's control. A convenience callback or a local socket alone is not that protection.

An authorized receiving application can always copy the value. Provider-side revocation remains necessary after exposure. Avoid promises that SDK retrieval makes a copied credential non-exportable or erases it after use.

## Future TODO

- [ ] Define separately authorized programmatic SDK write/update/delete operations, using local encryption and explicit write credentials or human administrative authorization. Keep runtime read credentials read-only.
- [ ] Evaluate a hosted browser-to-local connector bridge only if a concrete user flow requires it; specify origin binding, local authentication, replay/CSRF protection and permissions first. It is not required for the simpler initial version.
- [ ] Deliver the confirmed one-time workload-provisioning requirement through the [redesign plan](sdk-redesign-proposal.md), including recipient verification, authenticated encrypted transport and cloned-identity/revocation limits. General email/website transfer remains excluded.
- [ ] Provide an optional task-specific agent-tool integration with output/error redaction. Keep the base store provider-independent; adapters are separate integrations.
- [ ] Decide whether stronger model isolation needs a restricted executor/OS identity. Specify and test the threat model before promising that an agent cannot obtain plaintext.

## Required acceptance evidence before replacement release

- Correct locally encrypted upload/decryption, wrong-key/tamper rejection and bound account/vault/project/name context.
- Encrypted private-key persistence; wrong local passphrase, key loss and fresh-device behavior without recovery bypasses.
- Account isolation and credential expiry/revocation, read-only enforcement, no secret-bearing errors/logs and metadata lookup behavior.
- Supported optional browser encryption, with no private-key upload and clear hosted-code compromise limits.
- Safe agent-tool success/failure outputs, provider error redaction and demonstrations distinguishing ordinary non-disclosure from arbitrary-code execution limits.
- Migration/upgrade/rollback behavior preserving existing customer data, plus tests matching the finalized replacement wire format.

These decisions supersede conflicting target-product requirements in the older multi-machine/root-recovery design. They do not modify the earlier running application or migrate its data.

## Audit trail

The [audit guide](audit.md) defines metadata-only event coverage, transaction/failure behavior, account-scoped activity, signed session webhooks and maintenance retention. Migration 2, restricted runtime grants and separate webhook configuration are required for rollout. Local decryption, provider usage and Clerk failed-sign-in details are outside the application event stream. Immutable external export and automated alert delivery remain follow-up work.
