import type { Metadata } from "next";
import { Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import { RoleProvider } from "@/lib/hooks/useRole";
import { ToastProvider } from "@/lib/hooks/useToast";
import { FilterProvider } from "@/lib/hooks/useGlobalFilters";

// Typographies du BearingPoint Design System : Hanken Grotesk (substitut documenté de la
// police corporate propriétaire) + Spline Sans Mono pour les données/chiffres.
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans" });
const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "BeTrack — BearingPoint Transformation Platform",
  description: "Plateforme de pilotage de transformation — savings, leviers, workstreams.",
};

// RoleProvider/ToastProvider/FilterProvider vivent ici (racine) plutôt que dans AppShell :
// /login en a besoin aussi, et AppShell n'enrobe désormais que les routes protégées.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className={`${hanken.variable} ${splineMono.variable} font-sans antialiased`}>
        <RoleProvider>
          <ToastProvider>
            <FilterProvider>{children}</FilterProvider>
          </ToastProvider>
        </RoleProvider>
      </body>
    </html>
  );
}
