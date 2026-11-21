# Live Vercel SDK round trip

**PASS — 2026-11-20.** On a new Agent37 VM, linked the owner's confirmed account to `https://passman.subdomain.wtf` through normal email-code sign-in and browser fingerprint approval.

Project: `vercel-sdk-test-1795216834878`. Stored key **`Vercel`**, value **`key-value@the rate 123`**. The SDK returned the exact value twice, including from a fresh VM process. The API returned ciphertext without the plaintext; the website showed the project/name without the value. A retained encrypted vault copy also decrypted the live entry successfully.

This used the API-compatible workspace `@keyman-mvp/client` **0.4.0**, packed and installed on Node.js 24.22.3. The replacement `@passman/sdk` API is still absent from the live site; this result does not validate its hosted rollout. Account signup requires website verification; the SDK creates/links the local vault.

## Code executed on the VM

After linking the vault, creating the project and issuing its scoped read credential, the complete store/read check was:

```js
import { readFile } from 'node:fs/promises';
import { unlockIdentity, uploadValue, KeymanClient } from '@keyman-mvp/client';

const { password, serviceKey, project } = JSON.parse(await readFile('./config.json'));
const identity = await unlockIdentity('./vault', password, { administrative: true });
await uploadValue(identity, project, 'Vercel', 'key-value@the rate 123');
const client = new KeymanClient({ identity, serviceKey, project });
const value = await client.getSecret({ name: 'Vercel' });
if (value !== 'key-value@the rate 123') throw Error('Value mismatch');
console.log('PASS: stored and retrieved the exact value');
```

`config.json` was an owner-only test input containing the local vault password, project name and service key. It was never uploaded to Passman or committed. Run the script from that protected directory with the packed SDK installed. The hardcoded value above is the owner's explicitly supplied test string; real values belong in protected input.

## Cleanup

The test entry and project remain on the website. Both temporary read/upload credentials were revoked; the read key then returned HTTP 401. VM `nrut87kw7m` was deleted, with Agent37 reporting no remaining instances. The test browser signed out and closed. AgentMail credentials and transient session tokens were removed.

To preserve access to this legacy account's immutable key binding, the encrypted vault and its owner-only unlock configuration remain privately in ignored `ignore-docs/live-vercel-test/`. That retained copy was verified before VM deletion. No provider API was called, no application code was changed, and nothing was deployed or published.
