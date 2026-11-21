"use client";
import {
  SignInButton,
  UserButton,
  useAuth,
  useReverification,
} from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { useState, type FormEvent } from "react";
import { bytes32 } from "@passman/protocol";
import styles from "../console.module.css";
import {
  approvalSchema,
  connectionMessage,
  requestConnection,
} from "./connection-request";
export default function Connect({ session }: { session: string }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const verifiedApprove = useReverification(async (fingerprint: string) =>
    requestConnection({
      session,
      fingerprint,
      token: await getToken({ skipCache: true }),
    }),
  );
  async function approve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fingerprint = bytes32.safeParse(new FormData(form).get("code"));
    if (!fingerprint.success) {
      setNotice("Paste the complete connection code from your terminal.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      approvalSchema.parse(await verifiedApprove(fingerprint.data));
      form.reset();
      setDone(true);
      setNotice("Connected. Return to your terminal to finish setup.");
    } catch (error) {
      setNotice(
        isReverificationCancelledError(error)
          ? "Verification was cancelled. Connect again and complete sign-in verification before the link expires."
          : connectionMessage(error),
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
        {isSignedIn ? <UserButton /> : null}
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
            <button disabled={busy}>
              {busy ? "Connecting…" : "Connect local client"}
            </button>
          </form>
        ) : null}
        <p role="status" aria-live="polite">
          {notice}
        </p>
      </section>
    </main>
  );
}
