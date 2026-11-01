# Production manual and adversarial testing — 2026-11-01

Target: `https://passman.subdomain.wtf`. Server source: `e4eee87f92d40d6c768e66cb2913234a96a6f47c`; public CLI/SDK: **0.1.1**. This was a live browser, inbox, VM and targeted API exercise, not just a test-suite run. It is a finite acceptance/security exercise, not an independent audit or production-security certification.

## Environment and boundaries

- Provisioned two disposable Agent37 Ubuntu VMs, each 2 vCPU / 4 GB RAM / 12 GB disk. Installed the public client as an unprivileged user on the main VM; the second VM never received a vault private key.
- Used two existing owner-supplied test accounts, A and B, in separate browser profiles. Both signed in with their actual passwords and completed real new-device email verification through AgentMail. No Clerk testing token, fabricated session, password reset or disabled protection was used.
- Preserved the existing Clerk accounts as explicitly requested. An initial signup attempt, before that clarification, was rejected; no account was created. Attempts to allocate separate inboxes were denied by the supplied inbox-scoped credentials; no inbox was created or removed.
- Used only named synthetic test values and projects beginning `manual-20261101-`. No customer/provider credential was used. Ordinary provider administrators' secrets stayed on the controller, rather than being placed on the VMs.
- The newly supplied Agent37 key was rejected with 401; the previously authorized parent-folder credential worked. This is an infrastructure-credential issue, not a Passman vulnerability.

## Findings and changes

| Finding | Result / significance | Action |
| --- | --- | --- |
| Production Clerk keys were also assigned to Preview | Confirmed configuration issue. Preview builds should not receive the production administrator credential. | Restricted both Clerk variables to Production; verified the new scope and that no existing Preview deployment needed retirement. Production health and browser behavior remained working. Future previews need isolated development auth/data. |
| Hostile-server record substitution | Confirmed the documented HPKE base-mode limitation. A simulated malicious server could return an attacker-chosen value encrypted using the public key; the released SDK accepted it. | No cryptographic redesign was introduced. Confidentiality and writer authenticity are separate requirements. Sender authentication must be designed/reviewed before promising protection against malicious-server value substitution. |
| Hostile-server rollback | Replaying the previously saved revision-1 response after a revision-2 update returned the old value successfully. | Documented freshness limitation, not a bypass of the honest server's optimistic-write checks. Independent freshness/checkpoint protection remains future work. |
| Ambiguous setup error | A wrong approval code was rejected, but the UI said only that the operation failed or fresh verification was required. | UX follow-up: distinguish safe error categories such as invalid code, expiration, conflict and unavailable service without exposing raw payloads. |
| No supported project/account purge | Secret deletion and revocation work; empty namespaces, bindings and credential history cannot be purged through the MVP UI/API. | Retained that metadata rather than resetting identities. Preserved encrypted test-vault backups privately before deleting the VMs. |

The simulated malicious-server tests substituted responses inside the test SDK transport. They did **not** modify production code or another user's records, recover an existing provider value, or obtain a private key. These limits were already documented in [security.md](security.md); the experiment demonstrates their practical effect.

## Actual checks

| Area / feature cases | Observed result |
| --- | --- |
| Installation — DIST-01/02/05 | Public shell installer succeeded without a checkout or system Node installation. CLI reported 0.1.1. Reinstallation retained the working vault and later decryption. No version upgrade was attempted in this run. |
| Production sign-in — AUTH-01/02/03, partial | Both existing accounts completed native browser password sign-in and genuine email verification. This does not establish ordinary new-user signup or every supported browser. |
| Sign-out state — AUTH-04 | Both signed out through the user menu. Browser session, one-time credential text and test workspace names disappeared from the page. Subsequent sign-in was not repeated. |
| Fresh verification — AUTH-06 | At first-factor age 11 minutes, a mutation opened Clerk reverification. Cancel did not create the project. Password verification resumed the intended project creation successfully. |
| Setup — SETUP-01/02/03/04/05 | Real VM CLI created local vaults; browser fingerprints matched the terminals. Wrong code, wrong fingerprint, absent loss acknowledgement and unknown claim secret were rejected. Correct native approvals completed both CLI account bindings. |
| Renewal and replay — SETUP-06/07/08 | Same-public-key renewal and one-time claim succeeded. Reusing a consumed claim returned 401, as the implementation specifies. A new key could not replace an existing account key (409). An expired approval was rejected. Only the disposable setup record's expiry was changed for the expiration test, then that record was deleted. |
| Vault — VAULT-01/02/03/04, partial | Directory/file modes were 0700/0600; wrong passphrase failed. Ordinary unlock omitted upload authorization. After Agent37 restart, the Linux boot ID changed and both original vaults decrypted the expected records. Symlink/ownership/large-file abuse variants were not repeated manually. |
| Local data lifecycle — DATA-01/02/03/05 | Created two projects in A through the website. Actual CLI uploads stored different values under the same name. Exact UTF-8 SDK retrieval, search, existence and missing-name checks passed. Duplicate project/write attempts and stale deletion failed. Explicit replacement advanced the revision to 2. |
| Browser encryption — DATA-08 | B created a same-named project and entered a synthetic value using the optional browser form with its trust warning/acknowledgement. B's local SDK decrypted the exact browser-entered value. |
| Deletion — DATA-04 | Cancelling the browser confirmation preserved B's entry; confirming deleted it. Wrong-account and stale-revision deletion requests failed. A's two remaining synthetic rows were removed during scoped teardown. |
| Account isolation — DATA-06, TOKEN-03 | Different accounts' same project/secret names returned different values. B did not receive A's project ID and could not issue a credential for it, revoke A's credential or delete A's secret. |
| Read/write boundaries — TOKEN-02/03/04/05 | Project-scoped read key could not retrieve another project, create projects or upload. Upload authority could not retrieve ciphertext. Extra credential fields attempting to change kind/account were rejected. |
| Expiration/revocation — TOKEN-02/07 | A's website revocation caused the actual VM SDK to reject later reads. Temporarily expiring only B's test read credential in the database caused 401; its original expiry was restored before final revocation. |
| Unregistered host — TOKEN-06 | The second VM downloaded authorized ciphertext with the read credential, by design. The response contained no plaintext/private key. A wrong private key and another account's private key could not decrypt/use A's record. This MVP does not authenticate machines using SSH signatures. |
| Encryption/storage — CRYPTO-02/04/05 | Altered ciphertext failed. Live API bodies contained ciphertext, not the synthetic plaintext. Inspection of the two remaining scoped test database records found encrypted envelopes and public-only JWKs, without synthetic plaintext or private-JWK components. This was not a whole-database scan. |
| Input/auth controls — AUTH-05, DATA-07, OPS-03/04, partial | Live wrong-account operations, foreign Origin, extra fields, oversized owner body, malformed JSON, wrong content type and missing public key were rejected. Forwarding headers did not redirect trust. Private state was no-store; `/.env` and `/.git/config` returned 404. Invalid/forged JWT denial was additionally verified in the earlier [setup repair](live-setup.md#login-unavailable-repair--2026-11-01). |

All stated positive/negative behaviors above were observed. An initial harness assertion expected 403/410 for consumed-claim replay; the actual 401 matched the implementation's documented unauthorized branch. The expectation was corrected rather than treating this correct rejection as a vulnerability.

## Cleanup

- Both VMs were deleted successfully and subsequent instance lookups returned 404. The VM without a private key was removed as soon as its ciphertext-only test completed.
- Test secrets remaining after UI tests were removed with exact test-account/project/name predicates. All credentials belonging to these newly registered test vaults were revoked. Final scoped counts: **zero test secrets, zero active test credentials**. Test setup records were removed; normal global rate counters were not reset.
- Existing Clerk accounts, passwords, immutable vault bindings, empty test projects and revoked credential history remain. The two test vault files were saved as private local backups before VM deletion; they are not in this repository or the production service. The owner should retain those test keys to reuse these already-bound accounts. Account login alone cannot replace them.
- Both browser sessions were signed out and the owned tabs closed. Inbox contents and the owner's supplied credentials were not deleted or rotated.
- No application source/protocol/vault-format change or new client release was required. The only live configuration fix was limiting production Clerk variables to Production. Documentation checks validate this report; they are not substitutes for the live evidence above.

## Remaining work

This run did not exercise production flooding/DoS, high-volume races, email/OTP brute force, dependency exploitation, backup/restore disaster drills, production key rotation, destructive database outages, every input boundary, Mac browser/CLI acceptance, or the entire version-upgrade matrix. No production counter was exhausted to test whether unrelated users would be blocked. Evaluate edge protection and the shared public setup bucket on an isolated deployment with a controlled traffic plan.

Sender authenticity/freshness, same-OS-user isolation, independent cryptographic review, restore procedures and controlled release operations remain important release decisions. Passing these checks does not mean that no vulnerabilities exist.
