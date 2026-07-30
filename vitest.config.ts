import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Next.js charge automatiquement .env.local (process.env.NEXT_PUBLIC_*) pour l'app réelle, mais
// Vitest (moteur Vite, pas Next) ne le fait pas tout seul pour process.env — seulement pour
// import.meta.env, et seulement les clés préfixées VITE_ par défaut. lib/firebase.ts lit
// process.env.NEXT_PUBLIC_FIREBASE_*, donc sans ce chargement explicite ces variables restent
// `undefined` en test. Sans conséquence pour getFirestore() (inerte tant qu'aucune requête n'est
// faite) — getAuth(), lui, valide sa config dès l'appel, mais lib/firebase.ts ne l'appelle plus
// qu'à la demande (getAuthInstance()), jamais au chargement du module : ce rechargement n'est
// donc plus requis pour éviter un crash en CI (où .env.local n'existe pas), seulement pour garder
// process.env cohérent avec Next.js en local si un test venait à avoir besoin de vraies valeurs.
process.env = { ...process.env, ...loadEnv("", process.cwd(), "") };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
  },
});
