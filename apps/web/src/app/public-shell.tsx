import Link from "next/link";
import type { ReactNode } from "react";
import CreatorContact from "./creator-contact";
import { PassmanMark } from "./landing";
import styles from "./public.module.css";

export default function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.site}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link href="/" aria-label="Passman home">
          <PassmanMark />
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/status">Status</Link>
          <Link href="/support">Support</Link>
          <a href="https://github.com/07rjain/passman/blob/main/docs/fresh-quickstart.md">
            Docs
          </a>
        </nav>
      </header>
      <main id="main-content" className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        <span>Experimental. Start with test secrets.</span>
        <Link href="/">Back to Passman</Link>
        <a href="/llms.txt">Agent docs</a>
        <CreatorContact className={styles.creatorContacts} />
      </footer>
    </div>
  );
}
