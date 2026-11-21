import PublicShell from "../public-shell";
import { pageMetadata } from "../site-metadata";
import styles from "../public.module.css";

export const metadata = pageMetadata(
  "Support and feedback | Passman",
  "Get help with Passman, report a bug or contact the maintainer privately about a security issue.",
  "/support",
);

export default function SupportPage() {
  return (
    <PublicShell>
      <h1>Help with Passman.</h1>
      <p className={styles.intro}>
        Contact the maintainer through GitHub Issues for setup questions, bug
        reports and feedback. Support is best-effort during the experimental
        beta, with no guaranteed response time.
      </p>
      <section className={styles.panel}>
        <h2>Questions, bugs and feedback</h2>
        <p>
          Check the{" "}
          <a href="https://github.com/07rjain/passman/blob/main/docs/troubleshooting.md">
            troubleshooting guide
          </a>{" "}
          and <a href="/status">service status</a> first, then open an issue
          with your operating system, Passman version, the safe error code and
          steps to reproduce using synthetic values.
        </p>
        <p>
          GitHub Issues are public. Never include secret values, service keys,
          passwords, private vault files, approval codes or full request
          headers.
        </p>
        <a
          className={styles.action}
          href="https://github.com/07rjain/passman/issues/new"
        >
          Open a support issue
        </a>
      </section>
      <section className={styles.panel}>
        <h2>Report a security issue privately</h2>
        <p>
          Use GitHub private vulnerability reporting for a suspected security
          problem. Include the affected version and a synthetic reproduction;
          keep sensitive details out of public issues.
        </p>
        <a href="https://github.com/07rjain/passman/security/advisories/new">
          Private vulnerability report
        </a>
      </section>
      <section className={styles.panel}>
        <h2>Lost access to your vault?</h2>
        <p>
          Keep existing local keys. For the fresh SDK, account login plus the
          vault password can restore administration and decryption from the
          encrypted synchronized package. Login alone cannot decrypt. If the
          password is forgotten and only read-only keys survive, administration
          cannot be recovered. Read the{" "}
          <a href="https://github.com/07rjain/passman/blob/main/docs/fresh-quickstart.md#password-changes-compromise-and-loss">
            restoration and loss guide
          </a>{" "}
          before changing local files.
        </p>
      </section>
    </PublicShell>
  );
}
