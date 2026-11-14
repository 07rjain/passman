# Passman landing page

The public page introduces the local-key vault to developers, shows a real SDK example and leads into installation or existing Clerk sign-in. The authenticated workspace and approval flow retain their existing behavior. The hero illustration explains the storage boundary using example metadata; it is not a live workspace or a complete cryptographic protocol diagram.

## Design direction

- Palette: pale sage `#f5f9f6` fading through soft paper `#fafbf9` to white `#ffffff`, charcoal `#242424`, graphite `#686868`, dark surface `#2b2b2b`. Controls, type and product illustration retain their neutral palette. Three faint, broad sage wave lines and a translucent band sit behind the hero; their minimum width keeps the curves gentle on mobile.
- Type: locally served Manrope for the public page, with the platform monospace stack reserved for code and example secret names. Large, closely spaced headings supply the identity without colored word accents.
- Layout: left-aligned copy and a concrete secret-flow illustration share the hero. A quiet three-part explanation leads to a light SDK section with a charcoal code pane, platform-specific installation and concise security questions. Mobile uses the same reading order in one column.
- Interaction: working install tabs, clipboard feedback with manual-copy fallback and native disclosure controls. The hero illustration and background waves stay still; they have no animation or regeneration control. The decorative wave SVG is a CSS background and cannot intercept input or enter the accessibility tree.

```text
wordmark        how it works / developers / docs        sign in
headline + actions                 local private key
                                   encrypted example project
                                   local SDK retrieval
local key                       encrypted store            local SDK
SDK explanation                 charcoal code example
installation steps              platform tabs + command
security questions
wordmark                        source / security / license
```

## Illustrating the product boundary

The key appears in a local-vault block above the service. The connecting line describes values being encrypted locally; it does not show the private key being uploaded. The service block uses clearly labeled example project and secret names with encrypted-value indicators. The final block shows ciphertext retrieval and local decryption by the SDK.

The diagram includes only synthetic metadata and fixed display text. It does not fetch an account, encrypt a value, generate a key or simulate an actual authenticated operation. Its labels are normal readable HTML, with decorative icons hidden from assistive technology. The nearby feature descriptions and security questions provide the qualifications that a compact illustration cannot: optional browser input trusts hosted JavaScript, application code can read plaintext, and private-key loss cannot be recovered by signing in.

The visual hierarchy comes from spacing, readable type and contrasting surfaces. The product flow is the hero's one detailed element; other sections remain quiet. Local fonts and small SVG icons avoid a remote rendering dependency or an art runtime in the production page.

## Site icons

The favicon reuses the header's Passman mark in charcoal on a rounded pale sage tile, keeping its contrast in light and dark browser chrome. The SVG source is `apps/web/src/app/icon.svg`; `favicon.ico` contains 16/32/48-pixel variants, and `apple-icon.png` is 180 pixels square. Derive the raster assets from the SVG when changing the mark. Next.js file-based metadata adds the icon links through the root layout, covering both the public page and authenticated workspace without a remote service or client script.

## Installation links

The platform tabs use the stable hosted URLs `https://passman.subdomain.wtf/install.sh` and `https://passman.subdomain.wtf/install.ps1`, matching the quickstart. The installers select the latest published client unless `PASSMAN_VERSION` is supplied, then verify its publisher signature and checksum. A version in an installer script's download URL does not pin the client version it selects. The release announcement also links to GitHub's latest release, so the landing page does not require a version edit after publication. Already installed clients update only when the installer is run again.

## Sharing, support and mobile use

Home, support and status pages supply canonical, Open Graph and Twitter metadata with a local 1200x630 PNG sharing card based on the same mark, Manrope type and pale sage waves. Metadata resolves against `APP_ORIGIN` when configured, otherwise the stable Passman origin. No remote image-generation or font service is used.

The public footer and dashboard link to `/support` and `/status`. Support routes ordinary questions and feedback to public GitHub Issues, warns against sensitive content and keeps vulnerability reports private; best-effort beta help has no guaranteed response time. Status shows only the existing service-readiness result and time, with unknown distinct from failed or ready. See [operations](operations.md#public-service-status) for its exact scope.

The dashboard keeps its account-keyed client component behind the server home-page entry. Public support/status routes remain usable without Clerk configuration. Below 800px, workspace navigation moves above the content; narrow screens use two navigation columns, stacked form controls and separate metadata/action rows. Long names, fingerprints and one-time credentials wrap inside their panels. Public controls have larger mobile touch targets. These presentation changes do not add a native mobile application or alter authorization.

The landing, support and status footers keep their existing content and add a separate creator-contact row for booking a call, visiting Rishabh’s website and email. The row inherits each footer’s typography/colors, wraps as needed, preserves keyboard focus and mobile touch targets, and uses ordinary links without an embed or tracking.
