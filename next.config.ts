import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  outputFileTracingIncludes: {
    // ffmpeg-static baixa o binário nativo (ffmpeg/ffmpeg.exe) no postinstall;
    // o tracing automático não pega — precisa pra conversão de áudio webm→ogg.
    // Glob recursivo (padrão da doc) pra garantir o binário Linux no bundle da Vercel.
    "/api/whatsapp/send-media": ["./node_modules/ffmpeg-static/**/*"],
  },
};

export default nextConfig;
