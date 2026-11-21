"use client";
import { useAuth } from "@clerk/nextjs";
import Landing from "./landing";
import Console from "./passman/console";
export default function FreshHome() {
  const { isLoaded, isSignedIn } = useAuth();
  return isLoaded && isSignedIn ? (
    <Console />
  ) : (
    <Landing fresh authReady={isLoaded} />
  );
}
