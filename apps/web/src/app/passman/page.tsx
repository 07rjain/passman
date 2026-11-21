import Console from "./console";
export const dynamic = "force-dynamic";
export default function Page() {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <Console />
  ) : (
    <main style={{ maxWidth: 720, margin: "10vh auto", padding: 24 }}>
      <h1>Passman</h1>
      <p>Account sign-in is not configured for this installation.</p>
    </main>
  );
}
