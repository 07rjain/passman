import Dashboard from "./dashboard";
import Landing from "./landing";

export default function Page() {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <Dashboard />
  ) : (
    <Landing authConfigured={false} />
  );
}
