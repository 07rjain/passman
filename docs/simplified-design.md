# Simplified Keyman design decisions

Status: accepted replacement direction, implemented experimentally in this standalone repository, with Vercel/Neon deployed and targeted acceptance recorded; see [live-setup.md](live-setup.md). The earlier application remains in the separate [Keyman repository](https://github.com/07rjain/keyman). This decision record describes the product boundary; [security.md](security.md) defines the implemented profile and [testing.md](testing.md) records verification limits. Passman client archives are distributed through GitHub Releases; npm-registry publication remains deferred.

## Core model

- Clerk authenticates people and authorizes account management.
- A trusted local setup command generates a vault encryption key pair. The private key stays in a passphrase-encrypted local file; the public key is registered with the account. OIDC identity and encryption keys are separate concepts.
- Secret names are readable metadata. Values are encrypted before upload and decrypted locally. Use an established hybrid-encryption implementation; internal ephemeral data keys are managed automatically, not presented as additional user credentials.
- Projects organize names and lookups; they are not separate cryptographic trust domains. Account isolation and explicit API authorization remain mandatory. Prefer unambiguous project/name arguments over parsing arbitrary dotted strings.
- Losing every usable copy of the required private key makes the affected values unrecoverable. No account-only reset, support escrow or recovery kit is planned for this simpler version.
- Multi-machine key transfer, private-key export/sharing and any email/website transfer flow are deferred. A fresh key pair on another machine cannot decrypt old records automatically. Sharing one private key also shares decryption authority and cannot provide independent cryptographic device revocation.

The initial implementation has one immutable vault public key per account, bound application-managed setup approval, and the HPKE/context profile in [security.md](security.md). The encryption key is not reused for signing. No old-application data migration or private-key transfer is implemented.

## Input paths and write authority

The preferred input path is a trusted local CLI/administrative library operation: accept the name/value locally, encrypt the value locally using the selected vault public key and upload only its ciphertext and public metadata. Existing CLI management and runtime application access are different permission classes.

An optional hosted form may encrypt values in the browser using the public key before upload. It must explain that the plaintext is accessible to that page's scripts before encryption. A compromised website can capture new input or substitute a public key; Web Crypto does not remove that application trust boundary. See [W3C security considerations](https://www.w3.org/TR/webcrypto/#security-considerations). Never request the vault private key in the hosted form to implement ordinary additions or replacements.

Local administrative upload is the recommended input experience; ordinary agent/runtime credentials remain read-only. CLI `put` and the separately exported `uploadValue` helper require short-lived upload authorization. Broader unattended SDK creation/update/deletion and a hosted-page-to-local-port bridge stay on the future TODO list. The runtime `KeymanClient` exposes no mutation method; read credentials never implicitly gain write permission.

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
- [ ] Design private-key transfer between machines separately, including recipient verification, encrypted transport and the limitations of cloned vault identities. Do not implement ordinary email attachments as a presumed secure transfer protocol.
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
