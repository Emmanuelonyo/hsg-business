import type { NextConfig } from "next";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** Browser calls same-origin /api/*; Next proxies to the Nest API. */
const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
export default nextConfig;
