"use client";

import { SignInButton } from "@clerk/nextjs";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./landing.module.css";

const repository = "https://github.com/07rjain/passman";
const docs = `${repository}/blob/main/docs`;
const installerOrigin = "https://passman.subdomain.wtf";
const installCommands = {
  unix: `curl -fsSL ${installerOrigin}/install.sh | sh`,
  windows: `Invoke-WebRequest -Uri ${installerOrigin}/install.ps1 -OutFile "$env:TEMP\\passman-install.ps1"\n& "$env:TEMP\\passman-install.ps1"`,
};
const sdkExample = `import { KeymanClient, unlockIdentity } from '@07rjain/passman';

const identity = await unlockIdentity(directory, passphrase);
const client = new KeymanClient({
  identity,
  serviceKey,
  project: 'my-app',
});

const value = await client.getSecret({ name: 'PAYMENTS_KEY' });`;

function Icon({
  name,
  size = 20,
}: {
  name: "key" | "box" | "code" | "copy" | "check" | "github" | "download";
  size?: number;
}) {
  const paths = {
    key: (
      <>
        <circle cx="8" cy="8" r="4" />
        <path d="m11 11 9 9m-5-5 3-3m-6 0 3-3" />
      </>
    ),
    box: (
      <>
        <path d="m12 3 9 5v9l-9 5-9-5V8Z" />
        <path d="m3 8 9 5 9-5M12 13v9M7.5 5.5l9 5" />
      </>
    ),
    code: (
      <>
        <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    github: (
      <>
        <path d="M9 21c-5 1.5-5-2.5-7-3m14 6v-4a3.5 3.5 0 0 0-1-2.7c3.3-.4 6.8-1.6 6.8-7.3A5.7 5.7 0 0 0 20.2 6a5.3 5.3 0 0 0-.1-4s-1.3-.4-4.3 1.6a14.5 14.5 0 0 0-7.8 0C5 .6 3.7 1 3.7 1a5.3 5.3 0 0 0-.1 4A5.7 5.7 0 0 0 2 9c0 5.7 3.5 6.9 6.8 7.3A3.5 3.5 0 0 0 8 19v4" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function PassmanMark() {
  return (
    <span className={styles.wordmark}>
      <svg
        width="29"
        height="32"
        viewBox="0 0 29 32"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M5 27V13C5 3 23 3 23 13v5H12"
          stroke="currentColor"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        <circle cx="13" cy="26" r="3" fill="currentColor" />
      </svg>
      passman<span className={styles.wordmarkDot}>.</span>
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (reset.current) clearTimeout(reset.current);
    },
    [],
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("manual");
    }
    if (reset.current) clearTimeout(reset.current);
    reset.current = setTimeout(() => setStatus("idle"), 4000);
  }
  return (
    <span className={styles.copyWrap}>
      <button
        type="button"
        className={styles.copyButton}
        onClick={() => void copy()}
        aria-label={label}
      >
        <Icon name={status === "copied" ? "check" : "copy"} size={16} />
        <span>{status === "copied" ? "Copied" : "Copy"}</span>
      </button>
      <span role="status" className={styles.copyStatus}>
        {status === "copied"
          ? "Copied to clipboard."
          : status === "manual"
            ? "Select and copy the code below."
            : ""}
      </span>
    </span>
  );
}

function SecretFlow() {
  return (
    <figure
      className={styles.secretFlow}
      aria-label="Illustrated secret flow from your machine through encrypted storage to the local SDK"
    >
      <div className={styles.flowHeading}>
        <span>One secret. A clear boundary.</span>
        <span>Example flow</span>
      </div>
      <div className={styles.localVault}>
        <span className={styles.localIcon}>
          <Icon name="key" size={23} />
        </span>
        <div>
          <strong>Your machine</strong>
          <span>Private key in your local vault</span>
        </div>
        <span className={styles.localOnly}>Stays here</span>
      </div>
      <div className={styles.flowConnection} aria-hidden="true">
        <span />
        <span>
          <Icon name="check" size={12} />
          Values encrypted locally
        </span>
      </div>
      <div className={styles.storageWindow}>
        <div className={styles.storageHeader}>
          <span>
            <Icon name="box" size={18} />
            <strong>Passman</strong>
          </span>
          <span className={styles.storageLabel}>Encrypted storage</span>
        </div>
        <div className={styles.projectHeader}>
          <span className={styles.projectFolder}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2 5h6l2 2h8v10H2V5Z"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
            my-app
          </span>
          <span>Example project</span>
        </div>
        <div className={styles.secretTable}>
          <div className={styles.tableHeading}>
            <span>Name</span>
            <span>Stored value</span>
          </div>
          {["PAYMENTS_KEY", "DATABASE_URL", "WEBHOOK_SECRET"].map((name) => (
            <div className={styles.secretRow} key={name}>
              <code>{name}</code>
              <span>
                <svg
                  width="11"
                  height="13"
                  viewBox="0 0 12 14"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3 6V4a3 3 0 0 1 6 0v2M2 6h8v7H2z"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                </svg>
                Encrypted
              </span>
            </div>
          ))}
        </div>
        <div className={styles.storageFooter}>
          <Icon name="key" size={13} />
          <span>Read-only application access</span>
        </div>
      </div>
      <div className={styles.flowConnection} aria-hidden="true">
        <span />
        <span>Ciphertext to your application</span>
      </div>
      <div className={styles.localSdk}>
        <div>
          <Icon name="code" size={17} />
          <strong>Your application</strong>
          <span>Local SDK</span>
        </div>
        <code>
          await client.getSecret({"{"}
          <br />
          &nbsp; name: <span>'PAYMENTS_KEY'</span>
          <br />
          {"}"});
        </code>
        <p>
          <Icon name="check" size={13} />
          Decrypted locally. Ready for your code.
        </p>
      </div>
      <figcaption>
        The service stores encrypted values.
        <br />
        Your private key stays on your machine.
      </figcaption>
    </figure>
  );
}

function SignInAction({
  configured,
  ready,
  children,
  className,
}: {
  configured: boolean;
  ready: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!configured)
    return (
      <a className={className} href={`${docs}/quickstart.md`}>
        Read the docs
      </a>
    );
  return (
    <SignInButton mode="modal">
      <button className={className} type="button" disabled={!ready}>
        {ready ? children : "Loading sign-in…"}
      </button>
    </SignInButton>
  );
}

export default function Landing({
  authConfigured = true,
  authReady = true,
}: {
  authConfigured?: boolean;
  authReady?: boolean;
}) {
  const [platform, setPlatform] = useState<"unix" | "windows">("unix");
  const tabsId = useId();
  const command = installCommands[platform];
  return (
    <div className={styles.landing}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <a href="#" className={styles.homeLink} aria-label="Passman home">
          <PassmanMark />
        </a>
        <nav className={styles.navigation} aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#developers">For developers</a>
          <a href={`${docs}/quickstart.md`}>Docs</a>
        </nav>
        <div className={styles.headerActions}>
          <a
            href={repository}
            className={styles.githubLink}
            aria-label="Passman on GitHub"
          >
            <Icon name="github" size={21} />
          </a>
          <SignInAction
            configured={authConfigured}
            ready={authReady}
            className={styles.signIn}
          >
            Sign in
          </SignInAction>
        </div>
      </header>
      <main id="main-content">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <a
              className={styles.releaseLink}
              href={`${repository}/releases/latest`}
            >
              <span />
              Latest Passman release
              <svg
                width="15"
                height="15"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="m6 4 4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </a>
            <h1 id="hero-title">
              <span>Keep the key.</span>
              <br />
              <span>Ship the code.</span>
            </h1>
            <p className={styles.heroDescription}>
              A simple home for your application secrets. Encrypt locally, store
              them in Passman, and decrypt in your code. The private key stays
              on your machine.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href="#get-started">
                Get started
                <Icon name="download" size={17} />
              </a>
              <a className={styles.sourceButton} href={repository}>
                <Icon name="github" size={18} />
                Explore the source
              </a>
            </div>
            <p className={styles.platformNote}>
              <span className={styles.platformSymbols} aria-hidden="true">
                ⌘{" "}
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path
                    fill="currentColor"
                    d="M0 1.5 5.3.7v5H0zm6-.9L12 0v5.7H6zM0 6.3h5.3v5L0 10.5zm6 0h6V12l-6-.6z"
                  />
                </svg>{" "}
                $
              </span>
              For macOS, Linux and Windows
            </p>
          </div>
          <SecretFlow />
        </section>

        <section
          className={styles.principles}
          id="how-it-works"
          aria-label="How Passman works"
        >
          <article>
            <span className={styles.featureIcon}>
              <Icon name="key" />
            </span>
            <div>
              <h2>Local keys. Your control.</h2>
              <p>
                Your private key lives in a passphrase-encrypted vault on your
                machine.
              </p>
            </div>
          </article>
          <article>
            <span className={styles.featureIcon}>
              <Icon name="box" />
            </span>
            <div>
              <h2>Encrypted before it leaves.</h2>
              <p>
                The CLI encrypts your values before upload. Passman stores the
                ciphertext.
              </p>
            </div>
          </article>
          <article>
            <span className={styles.featureIcon}>
              <Icon name="code" />
            </span>
            <div>
              <h2>Ready for your application.</h2>
              <p>
                Scoped, read-only credentials fetch your data. The SDK decrypts
                it locally.
              </p>
            </div>
          </article>
        </section>

        <section
          className={styles.developers}
          id="developers"
          aria-labelledby="developers-title"
        >
          <div className={styles.developerCopy}>
            <span className={styles.sectionKicker}>
              <Icon name="code" size={17} />
              Built for your code
            </span>
            <h2 id="developers-title">
              One less secret
              <br />
              in your source.
            </h2>
            <p>
              Keep values out of your repository. Organize them by project, give
              your application read-only access, and retrieve exactly what it
              needs.
            </p>
            <a href={`${docs}/reference.md`}>
              Meet the TypeScript SDK
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 12 12 4M4 4h8v8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </a>
            <p className={styles.sdkBoundary}>
              Decrypted values are available to your application. Keep them out
              of logs and model output.
            </p>
          </div>
          <div className={styles.codeWindow}>
            <div className={styles.codeHeader}>
              <span>
                <span className={styles.fileDot} />
                your-app.ts
              </span>
              <CopyButton text={sdkExample} label="Copy SDK example" />
            </div>
            <pre tabIndex={0} aria-label="TypeScript SDK example">
              <code>
                <span className={styles.syntaxKeyword}>import</span>
                {" { KeymanClient, unlockIdentity } "}
                <span className={styles.syntaxKeyword}>from</span>
                {"\n  "}
                <span className={styles.syntaxString}>
                  {"'@07rjain/passman'"}
                </span>
                {";\n\n"}
                <span className={styles.syntaxKeyword}>const</span>
                {" identity = "}
                <span className={styles.syntaxKeyword}>await</span>
                {" unlockIdentity(\n  directory, passphrase,\n);\n"}
                <span className={styles.syntaxKeyword}>const</span>
                {" client = "}
                <span className={styles.syntaxKeyword}>new</span>
                {" KeymanClient({\n  identity,\n  serviceKey,\n  project: "}
                <span className={styles.syntaxString}>{"'my-app'"}</span>
                {",\n});\n\n"}
                <span className={styles.syntaxKeyword}>const</span>
                {" value = "}
                <span className={styles.syntaxKeyword}>await</span>
                {" client.getSecret({\n  name: "}
                <span className={styles.syntaxString}>{"'PAYMENTS_KEY'"}</span>
                {",\n});"}
              </code>
            </pre>
            <div className={styles.codeFooter}>
              <span />
              <span>Retrieved as ciphertext. Decrypted here.</span>
            </div>
          </div>
        </section>

        <section
          className={styles.getStarted}
          id="get-started"
          aria-labelledby="install-title"
        >
          <div className={styles.installIntro}>
            <span className={styles.sectionKicker}>
              From setup to your first secret
            </span>
            <h2 id="install-title">
              Make room for
              <br />
              better secrets.
            </h2>
            <p>
              No source checkout. No system-wide runtime.
              <br />
              Just a small CLI and your local vault.
            </p>
            <a className={styles.textLink} href={`${docs}/quickstart.md`}>
              Follow the full quickstart
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 12 12 4M4 4h8v8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </a>
          </div>
          <div className={styles.installSteps}>
            <div className={styles.installStep}>
              <span className={styles.stepNumber}>1</span>
              <div className={styles.stepContent}>
                <h3>Install Passman</h3>
                <div className={styles.installTerminal}>
                  <div className={styles.installToolbar}>
                    <div
                      role="tablist"
                      aria-label="Installation platform"
                      className={styles.tabs}
                    >
                      {(
                        [
                          ["unix", "macOS / Linux"],
                          ["windows", "Windows"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          id={`${tabsId}-${value}`}
                          type="button"
                          role="tab"
                          aria-selected={platform === value}
                          aria-controls={`${tabsId}-command`}
                          tabIndex={platform === value ? 0 : -1}
                          className={
                            platform === value ? styles.activeTab : undefined
                          }
                          onClick={() => setPlatform(value)}
                          onKeyDown={(event) => {
                            if (
                              [
                                "ArrowLeft",
                                "ArrowRight",
                                "Home",
                                "End",
                              ].includes(event.key)
                            ) {
                              event.preventDefault();
                              const next =
                                event.key === "Home"
                                  ? "unix"
                                  : event.key === "End"
                                    ? "windows"
                                    : platform === "unix"
                                      ? "windows"
                                      : "unix";
                              setPlatform(next);
                              document
                                .getElementById(`${tabsId}-${next}`)
                                ?.focus();
                            }
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <CopyButton
                      key={platform}
                      text={command}
                      label={`Copy ${platform === "unix" ? "macOS and Linux" : "Windows"} installation command`}
                    />
                  </div>
                  <div
                    role="tabpanel"
                    id={`${tabsId}-command`}
                    aria-labelledby={`${tabsId}-${platform}`}
                  >
                    <pre tabIndex={0}>
                      <code>{command}</code>
                    </pre>
                  </div>
                </div>
                <p className={styles.installHint}>
                  {platform === "unix"
                    ? "Includes a private Node.js runtime. No sudo needed."
                    : "Download and review the script before running it. Use local NTFS storage and your organization’s script policy."}
                </p>
              </div>
            </div>
            <div className={styles.installStep}>
              <span className={styles.stepNumber}>2</span>
              <div className={styles.stepContent}>
                <h3>Connect your local vault</h3>
                <p>
                  Run{" "}
                  <code>
                    {platform === "unix"
                      ? "~/.local/bin/passman login"
                      : '& "$env:LOCALAPPDATA\\Passman\\bin\\passman.cmd" login'}
                  </code>{" "}
                  and approve the request in your browser.
                </p>
              </div>
            </div>
            <div className={styles.installStep}>
              <span className={styles.stepNumber}>3</span>
              <div className={styles.stepContent}>
                <h3>Add a project. Store your first value.</h3>
                <p>
                  Create a project in your workspace, then run{" "}
                  <code>
                    {platform === "unix"
                      ? "~/.local/bin/passman put --project my-app --name PAYMENTS_KEY"
                      : '& "$env:LOCALAPPDATA\\Passman\\bin\\passman.cmd" put --project my-app --name PAYMENTS_KEY'}
                  </code>{" "}
                  to enter and encrypt a value locally.
                </p>
                <SignInAction
                  configured={authConfigured}
                  ready={authReady}
                  className={styles.workspaceLink}
                >
                  Open your workspace
                </SignInAction>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.questions} aria-labelledby="questions-title">
          <div>
            <span className={styles.sectionKicker}>
              A few things worth knowing
            </span>
            <h2 id="questions-title">
              Clear boundaries.
              <br />
              No secret promises.
            </h2>
            <a className={styles.textLink} href={`${docs}/security.md`}>
              Read the security model
              <Icon name="key" size={16} />
            </a>
          </div>
          <div className={styles.answers}>
            {[
              [
                "Does Passman ever see my secret values?",
                "When you use the local CLI, values are encrypted on your machine before upload. The optional browser form can read new values before encryption, so it trusts the website’s JavaScript. Use local input when that distinction matters.",
              ],
              [
                "What happens if I lose my private key?",
                "There is no private-key recovery, reset or transfer service. Signing in cannot replace a lost key or recover its ciphertext. Keep access to your existing local vault and its passphrase.",
              ],
              [
                "Can I use this with an AI agent?",
                "The SDK returns plaintext to the calling application. An agent with equivalent local access can expose it. Use trusted application code that returns task results, and keep credentials and values out of model output.",
              ],
              [
                "Is Passman ready for production?",
                "Passman is experimental software. Start with synthetic secrets. The source is available under PolyForm Noncommercial 1.0.0; commercial licensing, broader platform acceptance and independent security review remain future work.",
              ],
            ].map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <a className={styles.homeLink} href="#" aria-label="Passman home">
          <PassmanMark />
        </a>
        <p>Keep something to yourself.</p>
        <nav aria-label="Footer navigation">
          <a href="/status">Status</a>
          <a href="/support">Support</a>
          <a href={repository}>Source</a>
          <a href={`${docs}/security.md`}>Security</a>
          <a href={`${repository}/blob/main/LICENSE`}>License</a>
        </nav>
        <span className={styles.experimental}>
          <span />
          Experimental. Start with test secrets.
        </span>
      </footer>
    </div>
  );
}
