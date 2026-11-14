import PublicShell from "../public-shell";
import { pageMetadata } from "../site-metadata";
import styles from "../public.module.css";
import ServiceHealth from "./service-health";

export const metadata = pageMetadata(
  "Service status | Passman",
  "Check current Passman service availability and find support.",
  "/status",
);

export default function StatusPage() {
  return (
    <PublicShell>
      <h1>Service status.</h1>
      <p className={styles.intro}>
        Check whether Passman is responding before starting setup or retrying an
        operation.
      </p>
      <ServiceHealth />
      <section className={styles.panel}>
        <h2>What this check covers</h2>
        <p>
          The check confirms that the API can respond with its required
          configuration and reach its storage. It runs when you open this page
          and every minute while the page is visible.
        </p>
        <p>
          Sign-in, email delivery and individual vault operations are not tested
          here. This page shows a point-in-time check, not an uptime history or
          an incident feed.
        </p>
        <p>
          If a request fails, keep your existing vault and try again later.{" "}
          <a href="/support">Contact support</a> if the issue continues.
        </p>
      </section>
    </PublicShell>
  );
}
