"use client";
import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState, type FormEvent } from "react";
import {
  API_PATH,
  anchorSchema,
  bytes32,
  credentialScopeSchema,
  failure,
  id,
  label,
  projectName,
  sealValue,
  secretName,
  z,
} from "@passman/protocol";
import styles from "./console.module.css";

const statusSchema = z.object({
  anchor: anchorSchema,
  epoch: z.number().int().positive(),
  generation: z.number().int().positive(),
  syncId: id,
  activeKey: z.object({
    id: bytes32,
    version: z.number().int().positive(),
    publicKey: z.object({
      kty: z.literal("OKP"),
      crv: z.literal("X25519"),
      x: bytes32,
    }),
  }),
});
const projectsSchema = z.object({
  projects: z.array(
    z.object({
      id,
      name: projectName,
      createdAt: z.string(),
      secretCount: z.number(),
    }),
  ),
});
const installationsSchema = z.object({
  installations: z.array(
    z.object({
      id,
      label,
      kind: z.string(),
      firstSeen: z.string(),
      lastSeen: z.string(),
      status: z.enum(["active", "inactive"]),
    }),
  ),
});
const credentialsSchema = z.object({
  credentials: z.array(
    z.object({
      id,
      kind: z.string(),
      revoked: z.boolean(),
      expiresAt: z.string().nullable(),
      scope: z.object({ label, bootstrap: z.boolean() }),
    }),
  ),
});

export default function Console() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [projects, setProjects] = useState<
    z.infer<typeof projectsSchema>["projects"]
  >([]);
  const [installations, setInstallations] = useState<
    z.infer<typeof installationsSchema>["installations"]
  >([]);
  const [credentials, setCredentials] = useState<
    z.infer<typeof credentialsSchema>["credentials"]
  >([]);
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [serviceKey, setServiceKey] = useState("");
  async function api(path: string, body?: unknown) {
    const token = await getToken();
    if (!token) failure("UNAUTHORIZED");
    const r = await fetch(`${API_PATH}/console/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value: unknown = await r.json();
    if (!r.ok) {
      const parsed = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(value);
      throw new Error(parsed.success ? parsed.data.error.code : "UNAVAILABLE");
    }
    return value;
  }
  async function refresh() {
    const [p, m, c] = await Promise.all([
      api("projects"),
      api("installations"),
      api("credentials"),
    ]);
    setProjects(projectsSchema.parse(p).projects);
    setInstallations(installationsSchema.parse(m).installations);
    setCredentials(credentialsSchema.parse(c).credentials);
    setReady(true);
  }
  useEffect(() => {
    if (isSignedIn)
      void refresh().catch(() =>
        setNotice(
          "Run local setup first, or sign in again with recent verification.",
        ),
      );
    // Refresh is explicit after mutation; tokens are acquired for each request.
  }, [isSignedIn]);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch {
      setNotice(
        "The request could not be completed. Check your sign-in and project selection, then try again. Existing names cannot be submitted again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function createProject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    void act(async () => {
      await api("projects", { name: projectName.parse(data.get("project")) });
      form.reset();
      await refresh();
      setNotice("Project created.");
    });
  }
  function pending(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    void act(async () => {
      const p = projects.find((p) => p.name === selected);
      if (!p) failure("INVALID_REQUEST");
      const status = statusSchema.parse(await api("status"));
      const record = await sealValue(
        z.string().parse(data.get("value")),
        status.activeKey.publicKey,
        {
          version: 1,
          origin: window.location.origin,
          accountId: status.anchor.accountId,
          vaultId: status.anchor.vaultId,
          projectId: p.id,
          project: p.name,
          secretId: crypto.randomUUID(),
          name: secretName.parse(data.get("name")),
          keyId: status.activeKey.id,
          epoch: status.epoch,
          revision: 1,
          state: "pending",
        },
      );
      form.reset();
      await api("pending", { record, receiptId: crypto.randomUUID() });
      setNotice(
        "Saved as pending. Verify the exact project, name and value in your local Passman client before using it.",
      );
    });
  }
  function issue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    void act(async () => {
      const selection = data.get("scope"),
        expires = data.get("expires");
      const p = projects.find((p) => p.id === selection);
      const scope = credentialScopeSchema.parse({
        label: data.get("label"),
        projects: selection === "all" ? null : p ? [p.id] : [],
        bootstrap: data.get("bootstrap") === "on",
        expiresAt: expires ? new Date(String(expires)).getTime() : null,
      });
      if (!scope.expiresAt && data.get("nonexpiring") !== "on") {
        setNotice(
          "Choose an expiry date or explicitly select a non-expiring key.",
        );
        return;
      }
      const result = z
        .object({ serviceKey: z.string(), id })
        .parse(await api("service-keys", scope));
      setServiceKey(result.serviceKey);
      form.reset();
      await refresh();
      setNotice(
        "Save this service key in your application's protected storage. It is shown once.",
      );
    });
  }
  if (!isLoaded)
    return (
      <main className={styles.console}>
        <p role="status">Loading sign-in…</p>
      </main>
    );
  if (!isSignedIn)
    return (
      <main className={styles.console}>
        <h1>Passman</h1>
        <p>Sign in to manage projects and registered installations.</p>
        <SignInButton>
          <button>Sign in</button>
        </SignInButton>
      </main>
    );
  return (
    <main className={styles.console}>
      <header className={styles.header}>
        <div>
          <h1>Your Passman account</h1>
          <p>
            <a href="/legacy">Earlier workspace</a> ·{" "}
            <a href="https://github.com/07rjain/passman/blob/main/docs/fresh-quickstart.md">
              SDK/CLI setup
            </a>
          </p>
          <p>
            Manage projects here. Your applications decrypt secrets on their own
            machines.
          </p>
        </div>
        <UserButton />
      </header>
      <p className={styles.status} role="status" aria-live="polite">
        {notice}
      </p>
      {!ready && (
        <p className={styles.notice}>
          Complete <code>passman-v1 init</code> locally to create your vault.
          This page never asks for your vault password.
        </p>
      )}
      <section
        className={`${styles.section} ${styles.split}`}
        aria-labelledby="projects"
      >
        <div>
          <h2 id="projects">Projects</h2>
          <p>
            Choose a project when creating a pending secret. Names and secret
            counts are visible; stored values remain encrypted.
          </p>
          <ul>
            {projects.map((p) => (
              <li key={p.id}>
                {p.name} — {p.secretCount} active secrets
              </li>
            ))}
          </ul>
        </div>
        <form className={styles.form} onSubmit={createProject}>
          <label>
            New project name
            <input
              name="project"
              required
              pattern="[a-z0-9][a-z0-9_.-]{0,63}"
              placeholder="my-app"
            />
          </label>
          <button disabled={busy || !ready}>Create project</button>
        </form>
      </section>
      <section
        className={`${styles.section} ${styles.split}`}
        aria-labelledby="pending"
      >
        <div>
          <h2 id="pending">Add a pending secret</h2>
          <p>
            Verify the exact name and value locally before activation. Existing
            names cannot be changed here.
          </p>
          <p className={styles.notice}>
            This page can read values you type here. For sensitive entry, use
            the local administrative CLI or SDK.
          </p>
        </div>
        <form className={styles.form} onSubmit={pending}>
          <label>
            Project
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              required
            >
              <option value="">Choose a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Secret name
            <input
              name="name"
              required
              pattern="[A-Za-z_][A-Za-z0-9_.-]{0,127}"
              placeholder="OPENAI_API_KEY"
              autoComplete="off"
            />
          </label>
          <label>
            Value
            <input
              name="value"
              type="password"
              autoComplete="new-password"
              maxLength={65536}
            />
          </label>
          <button disabled={busy || !selected}>Save pending secret</button>
        </form>
      </section>
      <section
        className={`${styles.section} ${styles.split}`}
        aria-labelledby="credentials"
      >
        <div>
          <h2 id="credentials">Read service keys</h2>
          <p>
            A service key lists authorized projects and retrieves encrypted
            values. Decryption also needs the matching local vault.
          </p>
          <p>
            Bootstrap permission lets a new machine download the
            password-encrypted vault package. Enable it only for keys used to
            set up machines.
          </p>
          {serviceKey && (
            <div>
              <code className={styles.key}>{serviceKey}</code>
              <button
                className="secondary"
                onClick={() => {
                  setServiceKey("");
                  setNotice("Service key hidden.");
                }}
              >
                Hide saved key
              </button>
            </div>
          )}
        </div>
        <form className={styles.form} onSubmit={issue}>
          <label>
            Key label
            <input
              name="label"
              required
              maxLength={80}
              placeholder="Production worker"
            />
          </label>
          <label>
            Project scope
            <select name="scope" required>
              <option value="">Choose scope</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="all">All current and future projects</option>
            </select>
          </label>
          <label>
            Expiry
            <input name="expires" type="datetime-local" />
          </label>
          <label className={styles.row}>
            <input type="checkbox" name="nonexpiring" />
            Allow no expiry
          </label>
          <label className={styles.row}>
            <input type="checkbox" name="bootstrap" />
            Allow new-machine bootstrap
          </label>
          <button disabled={busy || !ready}>Create read key</button>
        </form>
      </section>
      <section className={styles.section}>
        <h2>Issued credentials</h2>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Label</th>
                <th>Kind</th>
                <th>Expiry</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((c) => (
                <tr key={c.id}>
                  <td>{c.scope.label}</td>
                  <td>
                    {c.kind}
                    {c.scope.bootstrap ? " · bootstrap" : ""}
                  </td>
                  <td>
                    {c.expiresAt
                      ? new Date(Number(c.expiresAt)).toLocaleString()
                      : "No expiry"}
                  </td>
                  <td>
                    {c.revoked
                      ? "Revoked"
                      : c.expiresAt && Number(c.expiresAt) <= Date.now()
                        ? "Expired"
                        : "Active"}
                    {!c.revoked && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await api(`credentials/${c.id}/revoke`, {});
                            await refresh();
                            setNotice(
                              "Credential revoked. Already copied values remain accessible to their holders.",
                            );
                          })
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Revoke and replace credentials through your local administrative
          client.
        </p>
      </section>
      <section className={styles.section}>
        <h2>Registered installations</h2>
        <p>
          {installations.length} registered,{" "}
          {installations.filter((i) => i.status === "active").length} recently
          active. Offline copies and cloned machines cannot be counted.
        </p>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Last seen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {installations.map((m) => (
                <tr key={m.id}>
                  <td>{m.label}</td>
                  <td>{m.kind}</td>
                  <td>{new Date(m.lastSeen).toLocaleString()}</td>
                  <td>{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
