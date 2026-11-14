import type { Metadata } from "next";

export function pageMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  const image = {
    url: "/social-card.png",
    width: 1200,
    height: 630,
    alt: "Passman — Keep the key. Ship the code. Application secrets, encrypted locally.",
  };
  return {
    metadataBase: new URL(
      process.env.APP_ORIGIN ?? "https://passman.subdomain.wtf",
    ),
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "Passman",
      title,
      description,
      url: path,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
