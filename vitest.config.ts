import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Next.js charge automatiquement .env.local (process.env.NEXT_PUBLIC_*) pour l'app réelle, mais
// Vitest (moteur Vite, pas Next) ne le fait pas tout seul pour process.env — seulement pour
// import.meta.env, et seulement les clés préfixées VITE_ par défaut. lib/firebase.ts lit
// process.env.NEXT_PUBLIC_FIREBASE_*, donc sans ce chargement explicite ces variables sont
// `undefined` en test. C'était sans conséquence tant que seul getFirestore() lisait cette config
// (inerte tant qu'aucune requête n'est faite), mais getAuth() valide sa config dès l'appel — sans
// apiKey, tout module qui importe (même transitivement) lib/firebase.ts fait planter Vitest à la
// collecte. On recharge donc ici le même .env.local que Next.js, avec un préfixe vide (3ᵉ
// argument "") pour ne pas se limiter aux seules variables VITE_*.
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
