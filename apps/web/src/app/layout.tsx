import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import "./styles.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Keyman — encrypted secrets, simple access",
  description: "An encrypted key-value vault for your applications.",
};
export default function Layout({ children }: { children: ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return (
    <html lang="en">
      <body>
        {publishableKey ? (
          <ClerkProvider publishableKey={publishableKey}>
            {children}
          </ClerkProvider>
        ) : (
          <main className="setup">
            <span className="brand">◈ KEYMAN</span>
            <h1>
              Your keys.
              <br />
              Your control.
            </h1>
            <p>
              Configure the Clerk publishable key to enable sign-in. Server API
              access also requires its database, origin and Clerk verification
              configuration.
            </p>
            <a href="https://github.com/07rjain/passman">
              Setup documentation ↗
            </a>
          </main>
        )}
      </body>
    </html>
  );
}
