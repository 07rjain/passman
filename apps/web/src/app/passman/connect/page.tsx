import Connect from "./connect";
import { id } from "@passman/protocol";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const session = id.safeParse((await searchParams).session);
  if (!session.success || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    return (
      <main style={{ maxWidth: 640, margin: "10vh auto", padding: 24 }}>
        <h1>Connect Passman CLI</h1>
        <p>
          Start <code>passman-v1 login</code> locally and use its connection
          link. Account sign-in must be configured.
        </p>
      </main>
    );
  return <Connect session={session.data} />;
}
