import styles from "./creator-contact.module.css";

export default function CreatorContact({ className }: { className?: string }) {
  return (
    <details className={`${styles.contact} ${className ?? ""}`}>
      <summary>
        Contact us
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m3 4.5 3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className={styles.panel}>
        <nav className={styles.links} aria-label="Contact us">
          <a href="https://calendly.com/07rishabh/quick-call">Book a call</a>
          <a href="https://www.bothrarishabh.com/">Website</a>
          <a href="mailto:07rishabhjain@gmail.com">Email</a>
        </nav>
      </div>
    </details>
  );
}
