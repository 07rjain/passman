"use client";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { useState, type FormEvent } from "react";
import { API_PATH, bytes32 } from "@passman/protocol";
import styles from "../console.module.css";
export default function Connect({ session }: { session: string }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function approve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fingerprint = bytes32.safeParse(new FormData(form).get("code"));
    if (!fingerprint.success) {
      setNotice("Paste the complete connection code from your terminal.");
      return;
    }
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in");
      const r = await fetch(`${API_PATH}/console/auth/approve`, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: session, fingerprint: fingerprint.data }),
      });
      if (!r.ok) throw new Error("Connection unavailable");
      form.reset();
      setDone(true);
      setNotice("Connected. Return to your terminal to finish setup.");
    } catch {
      setNotice(
        "Connection failed. Check the code and sign in again with recent verification. Start a new CLI login if the link expired.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.console} style={{ maxWidth: 720 }}>
      <header className={styles.header}>
        <div>
          <h1>Connect your local client</h1>
          <p>Continue the login you started in your terminal.</p>
        </div>
      </header>
      <section className={styles.section}>
        <p>
          Connect only a login you personally started in a terminal you control.
          For ten minutes, that client can issue read service keys, revoke
          credentials and download password-encrypted restoration packages.
          Writing activated values also requires your local signing key. Enter
          your vault password only in your local client.
        </p>
        {!isLoaded ? (
          <p>Loading sign-in…</p>
        ) : !isSignedIn ? (
          <SignInButton>
            <button>Sign in to connect</button>
          </SignInButton>
        ) : !done ? (
          <form className={styles.form} onSubmit={approve}>
            <label>
              Connection code
              <input
                name="code"
                type="password"
                required
                autoComplete="off"
                maxLength={43}
              />
              <small>
                Paste the code shown by the CLI you just started. Only connect a
                client you control.
              </small>
            </label>
            <button disabled={busy}>Connect local client</button>
          </form>
        ) : null}
        <p role="status" aria-live="polite">
          {notice}
        </p>
      </section>
    </main>
  );
}
