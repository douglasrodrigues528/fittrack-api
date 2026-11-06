import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { requireApiUrlForBuild } from "./lib/api-url";
import { SECURITY_HEADERS } from "./lib/security-headers";

export default function nextConfig(phase: string): NextConfig {
  // O build de produção falha sem o endereço da API (em vez de usar localhost em silêncio).
  if (phase === PHASE_PRODUCTION_BUILD) requireApiUrlForBuild(process.env);

  return {
    devIndicators: false,
    // Não anuncia o framework (`X-Powered-By: Next.js`), como a API.
    poweredByHeader: false,
    async headers() {
      return [{ source: "/:path*", headers: SECURITY_HEADERS }];
    },
  };
}
