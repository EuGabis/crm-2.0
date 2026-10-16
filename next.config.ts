import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Commit do build embutido no bundle do navegador: o `NovaVersao` compara com
  // o commit no ar (`/api/version`) para avisar quem está com a aba antiga.
  env: {
    NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
  },
};

export default nextConfig;
