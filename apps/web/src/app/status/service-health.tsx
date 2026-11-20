"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../public.module.css";

type Health = "checking" | "ready" | "unavailable" | "unknown";
const labels: Record<Health, string> = {
  checking: "Checking service…",
  ready: "Service check passed",
  unavailable: "Service check failed",
  unknown: "Status could not be confirmed",
};

export default function ServiceHealth() {
  const [health, setHealth] = useState<Health>("checking");
  const [checkedAt, setCheckedAt] = useState<Date>();
  const request = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setHealth("checking");
    let result: Health = "unknown";
    try {
      const response = await fetch("/api/passman/health", {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (response.status >= 500) result = "unavailable";
      else if (response.ok) {
        const body: unknown = await response.json();
        if (
          typeof body === "object" &&
          body !== null &&
          "status" in body &&
          body.status === "ready"
        )
          result = "ready";
      }
    } catch {
      // A network/timeout failure cannot establish the service's actual state.
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        setHealth(result);
        setCheckedAt(new Date());
      }
    }
  }, []);
  useEffect(() => {
    void check();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 60000);
    return () => {
      clearInterval(interval);
      request.current?.abort();
      request.current = null;
    };
  }, [check]);

  return (
    <section className={styles.panel} aria-label="Current service check">
      <div role="status" aria-atomic="true" className={styles.statusHeading}>
        <span
          aria-hidden="true"
          className={`${styles.dot} ${health === "ready" ? styles.ready : health === "unavailable" ? styles.unavailable : ""}`}
        />
        <h2>{labels[health]}</h2>
      </div>
      <p className={styles.checkDetails}>
        {checkedAt ? (
          <>
            Last checked:{" "}
            <time dateTime={checkedAt.toISOString()}>
              {checkedAt.toLocaleString()}
            </time>
          </>
        ) : (
          "Waiting for the first check."
        )}
      </p>
      {health === "unknown" && (
        <p>
          Check your connection and try again. An unknown result does not
          confirm an outage.
        </p>
      )}
      <button
        className={styles.action}
        disabled={health === "checking"}
        onClick={() => void check()}
        type="button"
      >
        Check again
      </button>
    </section>
  );
}
