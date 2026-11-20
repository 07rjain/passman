import Dashboard from "./dashboard";
import FreshHome from "./fresh-home";
import Landing from "./landing";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ device?: string }>;
}) {
  const parameters = await searchParams;
  if (parameters.device) return <Dashboard />;
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <FreshHome />
  ) : (
    <Landing fresh authConfigured={false} />
  );
}
