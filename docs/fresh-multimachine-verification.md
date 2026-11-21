# Fresh SDK: two-machine and multiple-vault verification

Date: 2026-11-20, 22:49–22:55 UTC. Result: **44 distinct checks passed** using synthetic values. This run tested the new `@passman/sdk` 1.0.0-alpha.1 on the controlling Linux machine and a newly provisioned Agent37 VM. No application-code change was needed. [Redacted results](assets/fresh-multimachine-results-2026-11-20.json) record each passed check and its timestamp.

This was an isolated fresh-API environment, not a rollout to `passman.subdomain.wtf`. The live site still runs the earlier API; its separate [live legacy round-trip](testing.md#live-deployed-sdk-round-trip--2026-11-20) does not establish new-SDK behavior.

## What multiple vaults mean

Each account has one vault and one active decryption-key version. Provisioned machines for that account receive the same key material, with independent local custody and installation IDs. Routine rotation adds another version and retains historical keys for existing records.

Accounts A, B and C have independent vaults and different keys. All three can coexist on either machine. The service credential selects the account, then the SDK loads only that account's custody for the configured service origin. Identical project and secret names do not require manual key selection. This is not support for several unrelated vaults inside one account.

## Environment and method

- Controller: Linux x64, Node.js 24.22.3/npm 11.19.1. Generated and retained all administrative signing material locally.
- Second host: temporary Agent37 Ubuntu 26.04 VM, 2 CPUs/4 GB RAM/12 GB disk. SDK workers ran as unprivileged UID 1001, using explicitly selected owner-only POSIX custody files, not a desktop keyring.
- API: the actual fresh API implementation and real PostgreSQL 17 on the VM. The API process used a restricted database login after owner-applied migrations/grants. The database port was bound to loopback.
- Packages: packed protocol, SDK and internal core artifacts, installed into separate consumers with a lockfile. Only curated code/packages and synthetic fixture material were transferred; no repository `.env`, real provider key, legacy vault or production database credential was uploaded.
- Transport: canonical HTTPS origin at the Agent37 port gateway. Controller requests included Agent37 gateway authentication locally. Receiver SDK requests used an explicit fetch adapter to the same API over VM loopback while retaining the canonical HTTPS protocol origin. The Agent37 workspace key stayed on the controller.
- Human authentication: isolated RSA-signed fixture JWTs, verified against a fixture public key with issuer/audience/expiry checks. This was not a live Clerk, website-login or native-management-session test. Server authorization, administrative proofs, record signatures, credential hashes and transfer/session checks still ran normally.
- Deployment test: an actual Node.js 24.22.3 Alpine container with a read-only filesystem, unprivileged UID, dropped capabilities, no-new-privileges, and read-only mounts containing runtime-only material plus its own read credential. It used host networking to reach the isolated API over loopback.

Artifact SHA-256 values identify the consumed local source build; they are not release signatures:

| Artifact | SHA-256 |
| --- | --- |
| `@passman/protocol` 1.0.0-alpha.1 | `70079d59eada2fefeb45e91562792e0faf5ffcdf302c53808a45774aa34b58a9` |
| `@passman/sdk` 1.0.0-alpha.1 | `af284778eee64911852b921a43fadd4c5368693b6f11e473ef1f122be2c2e0c5` |
| Internal `@keyman-mvp/core` 0.0.0 | `5037f81e37be3ee2bc3b1fb6e15e42c06329cf1350abb25c25eded03ad18d962` |

## Observed results

| Area | Result |
| --- | --- |
| Initial data | Three independent accounts, each with `demo/TOKEN`, `demo/EMPTY` and `demo/MULTILINE`, created through signed administrative SDK writes. Source reads exactly matched all inputs. |
| Credential without custody | Authorized metadata/ciphertext retrieval succeeded. Plaintext retrieval failed with `VAULT_NOT_PROVISIONED`. An ordinary read credential could not download the password-bootstrap package. |
| Transfer | Source created a long expiring SDK transfer code; receiver used its own same-account read credential. Received decryption keys exactly matched the source, with a new installation ID and no private signing key. The receiver did not receive the source password or administrative credentials. |
| Transfer denials | Wrong-account credential, substituted origin and incorrect claim secret were rejected. Expired/cancelled codes could not install a key. An acknowledged code could not enroll another receiver. |
| Interrupted delivery | Deliberately discarded successful claim and acknowledgement responses. Subsequent fresh SDK processes resumed using persisted recipient proof and custody, without another transfer code or password. |
| Exact retrieval | Two fresh remote Node processes retrieved exact normal, empty and Unicode/multiline values without a vault password. |
| Multiple account vaults | Added B through password bootstrap and C through code transfer while preserving A. Wrong bootstrap password failed. A/B/C coexisted in one protected directory, with distinct keys and correctly routed values for identical project/secret names. |
| No implicit account switch | Removing default A left no default instead of selecting B. A malformed explicit credential failed with `UNAUTHORIZED` and did not fall back. An adapter returning B's key for A failed with `CONTEXT_MISMATCH`. |
| Scope and runtime role | A project-scoped credential received `FORBIDDEN` for another project. A runtime read credential could not create a project. |
| Routine rotation | New version synchronized automatically on the receiving machine without the vault password. It read historical and newly written records and retained its installation ID. |
| Credential replacement | Revoked credential failed with `CREDENTIAL_REVOKED`. Replacement read authorization reused the installed keys and installation ID. B remained usable during A's changes. |
| Inventory | Account-specific console API results distinguished the source and receiver installations. IDs survived process restarts and credential replacement. This exercised the API, not the browser rendering. |
| Docker | A separately provisioned runtime-only mount decrypted B's value on container start and restart. Its logical installation ID differed from the host's and remained stable. |
| Compromise rotation | Replaced A's sync/decryption authority and password. Old credentials were revoked; a newly issued credential with old local authority failed with `CONTEXT_MISMATCH`. The old password failed bootstrap. Explicit new-password provisioning restored the retained machine, including historical/new-epoch reads. B/C were unaffected. No real provider credential was rotated. |
| Cold VM reboot | Kernel boot ID changed. After explicitly restarting the fixture database/API processes, all three accounts read correct values without passwords, retained their installation IDs and matched the source's current active key IDs. Saved account/default routing and the mounted container read also survived. No vault was recopied or restored for this check. |

The one-off harness needed corrections to file permissions, two expected error-code assertions and the API launch working directory after reboot. Final checks passed with the application source unchanged; these were fixture issues, not SDK fixes.

This run adds evidence for FRESH-01–03, 05–09, 16, the Linux/Docker portions of 18–19, 21–22, 31–40, 46 and 48. It does not close every requirement or abuse case in those IDs. Existing protocol/database suites remain the evidence for signature forgery, races, atomic audit failure and other cases not repeated here.

## Repeat the user flow on a fresh deployment

Use the [alpha setup guide](fresh-quickstart.md) first. These commands target the fresh API, not today's legacy website. In source development, replace `passman-v1` with `node packages/passman/dist/cli.js`.

On the source machine, with its administrative profile and the account's secrets already configured:

```sh
export PASSMAN_ORIGIN='https://YOUR_FRESH_PASSMAN_HOST'
passman-v1 login
passman-v1 vault transfer create --account ACCOUNT_A_UUID
```

The source asks locally for the vault password and deliberately displays the long transfer code. Deliver that code privately. Do not put it in a shell argument, chat log or committed file.

On the receiver, save its own account-A service credential, then receive the code through hidden input:

```sh
export PASSMAN_ORIGIN='https://YOUR_FRESH_PASSMAN_HOST'
passman-v1 service-key save --default
passman-v1 vault transfer receive
passman-v1 get --project demo --name TOKEN
```

`get` deliberately prints plaintext. Use synthetic values in a terminal test; application code should pass retrieved values directly to the authorized consumer without logging them. Restart the application and repeat retrieval; the ordinary read does not need a vault password.

For account B on the same receiver, create a separate B transfer on B's source machine. Save B's service credential without replacing the default, then explicitly select B:

```sh
passman-v1 service-key save
passman-v1 vault transfer receive --account ACCOUNT_B_UUID
passman-v1 get --account ACCOUNT_A_UUID --project demo --name TOKEN
passman-v1 get --account ACCOUNT_B_UUID --project demo --name TOKEN
```

For headless POSIX file custody, consistently add `--file-mode --store-dir /ABSOLUTE/PROTECTED/DIRECTORY` to the relevant commands. Native desktop custody is the default. Each destination keeps its own saved credential; never copy an administrative profile into a read-only workload. Password bootstrap is an alternative to transfer and requires an explicitly bootstrap-enabled credential or management authorization.

## Cleanup and limits

VM `kv9s2q3h2a` was deleted after testing. Agent37 confirmed `deleted: true`, and listing instances returned an empty list. Its test database, containers and key copies were removed with that VM. Temporary controller fixture credentials, vault passwords, signing/decryption material and staged operations were deleted. The existing Agent37 credential and the earlier live legacy test vault were untouched. No production data, website deployment or public package release changed.

The run establishes behavior for this Linux/Node/POSIX/Docker configuration. Windows DPAPI, macOS Keychain, Linux desktop sessions, Kubernetes, cloud-function platforms, real hosted browser flows, unattended service auto-start, load/abuse resistance and production operations still require their own acceptance. This is not a security audit.

A copied account key remains account-wide authority over ciphertext it can obtain; a project-scoped service key limits normal API access, not cryptographic exposure after a ciphertext leak. Inventory cannot count unseen offline copies or revoke their already copied key material. Routine rotation is not compromise containment. A captured full transfer code plus captured payload can remain decryptable offline after relay expiry; single-use/expiry constrain the live relay.
