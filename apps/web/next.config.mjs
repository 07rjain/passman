import path from "node:path";
export default {
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
