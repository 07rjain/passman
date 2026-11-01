"use client";
import { isReverificationHint } from "@clerk/shared/authorization-errors";
import {
  SignInButton,
  UserButton,
  useAuth,
  useUser,
  useReverification,
} from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  z,
  vaultSchema,
  projectSchema,
  encryptValue,
  errorSchema,
} from "@keyman-mvp/core";
const stateSchema = z.object({
  vault: vaultSchema.nullable(),
  projects: z.array(projectSchema),
  entries: z.array(
    z.object({
      project_id: z.string(),
      name: z.string(),
      revision: z.number(),
    }),
  ),
  truncated: z.boolean().optional(),
  credentials: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.string(),
      project_id: z.string().nullable(),
      expires_at: z.string(),
      revoked: z.boolean(),
    }),
  ),
});
type State = z.infer<typeof stateSchema>;
class RequestError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export default function Page() {
  const { userId } = useAuth();
  // Discard one-time credentials and workspace state when the account changes.
  return <Workspace key={userId ?? "signed-out"} />;
}
function Workspace() {
  const { isLoaded, isSignedIn, getToken } = useAuth(),
    { user } = useUser();
  const [data, setData] = useState<State>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [projectId, setProjectId] = useState(""),
    [issued, setIssued] = useState(""),
    [device, setDevice] = useState<{ id: string; keyId: string }>(),
    [deviceId, setDeviceId] = useState(""),
    [browserEntry, setBrowserEntry] = useState(false),
    [notice, setNotice] = useState("");
  const call = useCallback(
    async (path: string, payload?: unknown, allowReverification = false) => {
      const token = await getToken();
      if (!token) throw new RequestError("UNAUTHORIZED");
      const response = await fetch(path, {
        method: payload === undefined ? "GET" : "POST",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      const result: unknown = await response.json();
      if (
        response.status === 403 &&
        allowReverification &&
        isReverificationHint(result)
      )
        return result;
      if (!response.ok) {
        const parsed = errorSchema.safeParse(result);
        throw new RequestError(
          parsed.success ? parsed.data.error.code : "UNAVAILABLE",
        );
      }
      return result;
    },
    [getToken],
  );
  const verifiedCall = useReverification((path: string, payload?: unknown) =>
    call(path, payload, true),
  );
  const refresh = useCallback(async () => {
    setData(stateSchema.parse(await call("/api/console/state")));
  }, [call]);
  useEffect(() => {
    setDeviceId(
      new URLSearchParams(window.location.search).get("device") ?? "",
    );
  }, []);
  useEffect(() => {
    if (isSignedIn)
      void refresh().catch(() =>
        setError(
          "Workspace unavailable. Check server configuration and sign-in.",
        ),
      );
  }, [isSignedIn, refresh]);
  useEffect(() => {
    if (isSignedIn && deviceId)
      void call("/api/device/" + encodeURIComponent(deviceId))
        .then((value) =>
          setDevice(
            z.object({ id: z.string(), keyId: z.string() }).parse(value),
          ),
        )
        .catch(() =>
          setError(
            "This setup request is unavailable or expired. Restart login using the same local vault.",
          ),
        );
  }, [call, deviceId, isSignedIn]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
    } catch (e) {
      if (!isReverificationCancelledError(e))
        setError(
          e instanceof RequestError && e.code === "KEY_MISMATCH"
            ? "This account already has another vault key. Signing in cannot restore or replace that private key."
            : e instanceof RequestError && e.code === "CONFLICT"
              ? "The item changed or already exists. Refresh and retry deliberately."
              : "Operation failed or fresh verification is required. No sensitive error details are displayed.",
        );
    } finally {
      setBusy(false);
    }
  }
  if (!isLoaded)
    return (
      <main className="setup">
        <span className="brand">◈ KEYMAN</span>
        <p>Loading your workspace…</p>
      </main>
    );
  if (!isSignedIn)
    return (
      <main className="landing">
        <header>
          <span className="brand">◈ KEYMAN</span>
          <span className="tag">MVP · EXPERIMENTAL</span>
        </header>
        <div className="hero">
          <span className="eyebrow">ONE VAULT. SIMPLE ACCESS.</span>
          <h1>
            Secrets belong
            <br />
            with <em>you.</em>
          </h1>
          <p>
            Store encrypted values. Retrieve them in your code.
            <br />
            Keep the private key on your machine.
          </p>
          <SignInButton mode="modal">
            <button>Open your workspace →</button>
          </SignInButton>
          <div className="hero-note">
            Install once, sign in, then use Passman in your code.
          </div>
          <pre>
            <code>
              curl -fsSL https://passman.subdomain.wtf/install.sh | sh
            </code>
          </pre>
          <p>
            Then run <code>~/.local/bin/passman login</code> on macOS/Linux. No
            source checkout required.
          </p>
          <WindowsInstall />
        </div>
        <div className="features">
          <article>
            <span>01</span>
            <h3>Encrypt locally</h3>
            <p>The local CLI encrypts provider values before upload.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Stay organized</h3>
            <p>Readable names and projects keep your applications in order.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Use in code</h3>
            <p>
              Read-only credentials fetch ciphertext. The SDK decrypts locally.
            </p>
          </article>
        </div>
        <footer>
          Experimental build. Use synthetic secrets. No private-key recovery.
        </footer>
      </main>
    );
  const selected = data?.projects.find((p) => p.id === projectId),
    entries =
      data?.entries.filter((e) => !projectId || e.project_id === projectId) ??
      [];
  return (
    <div className="workspace">
      <aside>
        <span className="brand">◈ KEYMAN</span>
        <span className="eyebrow">YOUR WORKSPACE</span>
        <a href="#projects">▦ Projects</a>
        <a href="#entries">◇ Secrets</a>
        <a href="#activity">◷ Activity</a>
        <a href="#credentials">⚿ Service keys</a>
        <div className="aside-note">
          Provider values stay encrypted on the service.
          <br />
          <br />
          Secret names are readable metadata.
        </div>
      </aside>
      <main>
        <header>
          <span>Personal workspace / Vault</span>
          <div className="user">
            <span>{user?.primaryEmailAddress?.emailAddress}</span>
            <UserButton />
          </div>
        </header>
        <div className="content">
          <span className="eyebrow">YOUR VAULT, WITHOUT THE CLUTTER</span>
          <h1>Everything in its place.</h1>
          <p className="muted">
            Manage names and access here. Use your private key locally.
          </p>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
            </div>
          )}
          {device && (
            <section className="panel approval">
              <span className="eyebrow">LOCAL SETUP REQUEST</span>
              <h2>Connect your local vault</h2>
              <p>
                Compare this fingerprint with your own terminal. Enter the
                approval code printed there. Only approve a login you initiated.
              </p>
              <code className="fingerprint">{device.keyId}</code>
              <form
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  const fields = new FormData(event.currentTarget);
                  void perform(async () => {
                    await verifiedCall("/api/device/approve", {
                      id: device.id,
                      keyId: device.keyId,
                      userCode: String(fields.get("code")),
                      acknowledgeLoss: true,
                    });
                    setDevice(undefined);
                    setNotice(
                      "Approved. Return to the CLI to finish and save your account binding.",
                    );
                  });
                }}
              >
                <label>
                  Approval code
                  <input
                    required
                    name="code"
                    pattern="[a-f0-9]{12}"
                    autoComplete="off"
                  />
                </label>
                <label className="check">
                  <input required type="checkbox" />I understand that losing
                  every private-key copy loses access. There is no recovery
                  reset.
                </label>
                <button disabled={busy}>Approve this vault</button>
              </form>
            </section>
          )}
          {!data?.vault ? (
            <section className="panel">
              <h2>Start on your machine</h2>
              <p>
                Run the local setup command, then approve the fingerprint here.
                The website never needs your private key.
              </p>
              <pre>
                <code>
                  curl -fsSL https://passman.subdomain.wtf/install.sh | sh
                </code>
              </pre>
              <code>~/.local/bin/passman login</code>
              <WindowsInstall />
              <p className="muted">
                The installer includes a private Node.js runtime. Your vault
                stays on this machine; updates do not reset it.
              </p>
            </section>
          ) : (
            <>
              <div className="stats">
                <article>
                  <span>Projects</span>
                  <strong>{data.projects.length}</strong>
                </article>
                <article>
                  <span>Named secrets</span>
                  <strong>
                    {data.entries.length}
                    {data.truncated ? "+" : ""}
                  </strong>
                </article>
                <article>
                  <span>Active read credentials</span>
                  <strong>
                    {
                      data.credentials.filter(
                        (c) =>
                          c.kind === "read" &&
                          !c.revoked &&
                          Number(c.expires_at) > Date.now() / 1000,
                      ).length
                    }
                  </strong>
                </article>
              </div>
              <section id="projects" className="panel">
                <div className="section-title">
                  <div>
                    <h2>Projects</h2>
                    <p className="muted">
                      Simple namespaces for your named values.
                    </p>
                  </div>
                  <code title="Vault public-key fingerprint">
                    {data.vault.keyId.slice(0, 12)}…
                  </code>
                </div>
                <form
                  className="inline"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const name = String(new FormData(form).get("name"));
                    void perform(async () => {
                      const p = projectSchema.parse(
                        await verifiedCall("/api/console/projects", { name }),
                      );
                      setProjectId(p.id);
                      form.reset();
                    });
                  }}
                >
                  <input
                    required
                    name="name"
                    maxLength={80}
                    placeholder="New project name"
                    aria-label="New project name"
                  />
                  <button disabled={busy}>Create project</button>
                </form>
                <div className="project-list">
                  <button
                    className={!projectId ? "selected" : "secondary"}
                    onClick={() => setProjectId("")}
                  >
                    All projects
                  </button>
                  {data.projects.map((p) => (
                    <button
                      key={p.id}
                      className={p.id === projectId ? "selected" : "secondary"}
                      onClick={() => setProjectId(p.id)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </section>
              <section id="entries" className="panel">
                <div className="section-title">
                  <div>
                    <h2>{selected ? selected.name + " secrets" : "Secrets"}</h2>
                    <p className="muted">
                      Names are visible. Values are encrypted.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => setBrowserEntry(!browserEntry)}
                  >
                    Optional browser entry
                  </button>
                </div>
                <div className="local-tip">
                  Recommended: add values locally with{" "}
                  <code>passman put --project PROJECT --name KEY</code>.
                </div>
                {browserEntry && (
                  <form
                    className="browser-entry"
                    onSubmit={(event: FormEvent<HTMLFormElement>) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const fields = new FormData(form);
                      const name = String(fields.get("name")),
                        value = String(fields.get("value")),
                        project = String(fields.get("project"));
                      const p = data.projects.find((p) => p.id === project);
                      if (!p) return;
                      const prior =
                        data.entries.find(
                          (e) => e.project_id === p.id && e.name === name,
                        )?.revision ?? 0;
                      void perform(async () => {
                        const context = {
                          version: 1 as const,
                          accountId: data.vault!.accountId,
                          vaultId: data.vault!.id,
                          projectId: p.id,
                          project: p.name,
                          name,
                          revision: prior + 1,
                        };
                        const envelope = await encryptValue(
                          value,
                          data.vault!.publicKey,
                          context,
                        );
                        await verifiedCall("/api/console/upload", {
                          projectId: p.id,
                          name,
                          expectedRevision: prior,
                          envelope,
                        });
                        form.reset();
                        setNotice(
                          "Encrypted value saved. No plaintext value was included in the normal upload.",
                        );
                      });
                    }}
                  >
                    <p className="warning">
                      Optional browser input trusts this page’s JavaScript. A
                      compromised website could capture new values before
                      encryption. Use the local CLI for the stronger local-input
                      boundary.
                    </p>
                    <label>
                      Project
                      <select name="project" required defaultValue={projectId}>
                        <option value="">Choose a project</option>
                        {data.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Name
                      <input
                        required
                        name="name"
                        maxLength={256}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      New value
                      <input
                        required
                        name="value"
                        type="password"
                        autoComplete="new-password"
                      />
                    </label>
                    <label className="check">
                      <input required type="checkbox" />I accept the
                      browser-input boundary and intend to create or replace
                      this entry.
                    </label>
                    <button disabled={busy}>Encrypt in browser and save</button>
                  </form>
                )}
                {entries.length ? (
                  entries.map((entry) => (
                    <div className="entry" key={entry.project_id + entry.name}>
                      <div>
                        <strong>{entry.name}</strong>
                        <small>
                          {
                            data.projects.find((p) => p.id === entry.project_id)
                              ?.name
                          }{" "}
                          · revision {entry.revision}
                        </small>
                      </div>
                      <span className="pill">Encrypted value</span>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete ${entry.name}? Copies already retrieved cannot be erased.`,
                            )
                          )
                            void perform(async () => {
                              await verifiedCall("/api/console/delete", {
                                projectId: entry.project_id,
                                name: entry.name,
                                expectedRevision: entry.revision,
                              });
                            });
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="empty">
                    No entries in this view. Create a project, then add a value
                    locally.
                  </p>
                )}
                {data.truncated && (
                  <p className="warning">
                    Showing the first 1,000 entries. Use SDK search for
                    paginated results.
                  </p>
                )}
              </section>
              <Activity call={call} />
              <section id="credentials" className="panel">
                <h2>Read-only service keys</h2>
                <p className="muted">
                  These retrieve ciphertext. Decryption still needs your local
                  private key.
                </p>
                <form
                  className="inline wrap"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const form = event.currentTarget,
                      fields = new FormData(form);
                    void perform(async () => {
                      const result = z.object({ token: z.string() }).parse(
                        await verifiedCall("/api/console/credentials", {
                          label: String(fields.get("label")),
                          projectId: String(fields.get("project")) || null,
                          days: Number(fields.get("days")),
                        }),
                      );
                      setIssued(result.token);
                      form.reset();
                    });
                  }}
                >
                  <input
                    required
                    name="label"
                    maxLength={80}
                    placeholder="Application label"
                    aria-label="Credential label"
                  />
                  <select name="project" aria-label="Credential project scope">
                    <option value="">All account projects</option>
                    {data.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    name="days"
                    type="number"
                    min={1}
                    max={90}
                    defaultValue={30}
                    aria-label="Days until expiry"
                  />
                  <button disabled={busy}>Issue read key</button>
                </form>
                {issued && (
                  <div className="token-box">
                    <p>
                      Shown once. Save this credential privately; keep it out of
                      model prompts and source control.
                    </p>
                    <code>{issued}</code>
                    <button className="secondary" onClick={() => setIssued("")}>
                      I saved it — hide
                    </button>
                  </div>
                )}
                {data.credentials.map((c) => (
                  <div className="entry" key={c.id}>
                    <div>
                      <strong>{c.label}</strong>
                      <small>
                        {c.kind === "read" ? "Read-only" : "Local upload"} ·
                        expires{" "}
                        {new Date(Number(c.expires_at) * 1000).toLocaleString()}
                      </small>
                    </div>
                    <span className="pill">
                      {c.revoked
                        ? "Revoked"
                        : Number(c.expires_at) < Date.now() / 1000
                          ? "Expired"
                          : "Active"}
                    </span>
                    {!c.revoked && (
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          void perform(async () => {
                            await verifiedCall("/api/console/revoke", {
                              id: c.id,
                            });
                          });
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </section>
            </>
          )}
          <footer>
            Experimental MVP · No private-key recovery · Authorized applications
            receive plaintext locally.
          </footer>
        </div>
      </main>
    </div>
  );
}

const activitySchema = z.object({
  items: z.array(
    z.object({
      sequence: z.string(),
      event_id: z.string(),
      request_id: z.string(),
      occurred_at: z.string(),
      action: z.string(),
      outcome: z.string(),
      reason: z.string(),
      resource_id: z.string().nullable(),
      credential_id: z.string().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
function Activity({ call }: { call: (path: string) => Promise<unknown> }) {
  const [events, setEvents] = useState<z.infer<typeof activitySchema>>();
  const [outcome, setOutcome] = useState("");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function load(before?: string) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (before) query.set("before", before);
      if (outcome) query.set("outcome", outcome);
      if (action) query.set("action", action);
      setEvents(
        activitySchema.parse(await call("/api/console/activity?" + query)),
      );
    } catch {
      setError("Activity unavailable. Sign in again or retry.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <section id="activity" className="panel">
      <h2>Account activity</h2>
      <p>
        Server operations only. Retrieval means ciphertext was prepared for
        return; local decryption and provider use are not observed.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          Action{" "}
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {[
              "setup.start",
              "setup.inspect",
              "setup.approve",
              "setup.claim",
              "workspace.list",
              "project.create",
              "credential.create",
              "credential.revoke",
              "secret.write",
              "secret.delete",
              "secret.retrieve",
              "secret.search",
              "secret.exists",
              "upload.context",
              "activity.list",
              "session.created",
              "session.ended",
              "session.removed",
              "session.revoked",
            ].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Outcome{" "}
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">All outcomes</option>
            {["success", "denied", "error"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <button disabled={loading}>Load activity</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {events?.items.map((event) => (
        <div className="entry" key={event.event_id}>
          <div>
            <strong>{event.action}</strong>
            <small>
              {new Date(event.occurred_at).toLocaleString()} · {event.outcome} ·{" "}
              {event.reason}
            </small>
            <small>
              Request: {event.request_id}
              {event.resource_id ? " · Resource: " + event.resource_id : ""}
            </small>
          </div>
        </div>
      ))}
      {events && !events.items.length && <p>No matching events.</p>}
      {events?.nextCursor && (
        <button
          disabled={loading}
          onClick={() => void load(events.nextCursor!)}
        >
          Older events
        </button>
      )}
    </section>
  );
}

function WindowsInstall() {
  return (
    <details>
      <summary>Windows PowerShell installation</summary>
      <p>
        Windows x64/arm64, local NTFS storage. Download and review the installer
        before running it; no administrator access is needed.
      </p>
      <pre>
        <code>
          {
            'Invoke-WebRequest -Uri https://passman.subdomain.wtf/install.ps1 -OutFile "$env:TEMP\\passman-install.ps1"\n& "$env:TEMP\\passman-install.ps1"\n& "$env:LOCALAPPDATA\\Passman\\bin\\passman.cmd" login'
          }
        </code>
      </pre>
      <p>
        Follow your organization’s script execution policy. Updates preserve the
        existing local vault; a new machine cannot recover another machine’s
        private key.
      </p>
    </details>
  );
}
