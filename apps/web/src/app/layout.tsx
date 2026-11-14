import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import "./styles.css";
import { pageMetadata } from "./site-metadata";
export const dynamic = "force-dynamic";
export const metadata = pageMetadata(
  "Passman — keep the key, ship the code",
  "Encrypt application secrets locally, store ciphertext in Passman, and decrypt in your code. Your private key stays on your machine.",
  "/",
);
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
          children
        )}
      </body>
    </html>
  );
}
