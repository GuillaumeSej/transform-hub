import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { RoleProvider } from "@/lib/hooks/useRole";
import { ToastProvider } from "@/lib/hooks/useToast";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "BeTrack — BearingPoint Transformation Platform",
  description: "Plateforme de pilotage de transformation — savings, leviers, workstreams.",
};

// RoleProvider/ToastProvider vivent ici (racine) plutôt que dans AppShell : /login en a besoin
// aussi, et AppShell n'enrobe désormais que les routes protégées (voir app/(app)/layout.tsx).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className={`${inter.variable} font-sans antialiased`}>
        <RoleProvider>
          <ToastProvider>{children}</ToastProvider>
        </RoleProvider>
      </body>
    </html>
  );
}
