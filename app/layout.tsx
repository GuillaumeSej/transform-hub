import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import { RoleProvider } from "@/lib/hooks/useRole";
import { ToastProvider } from "@/lib/hooks/useToast";
import { FilterProvider } from "@/lib/hooks/useGlobalFilters";
import { I18nProvider } from "@/lib/i18n/useTranslation";
import { assetPath } from "@/lib/utils";

// Typographies du BearingPoint Design System : Hanken Grotesk (substitut documenté de la
// police corporate propriétaire) + Spline Sans Mono pour les données/chiffres.
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans" });
const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

// PWA : manifest + icônes → "Ajouter à l'écran d'accueil" installe BeTrack comme une app
// (plein écran, icône marque, splash noir). Chemins via assetPath pour le basePath GitHub Pages.
export const metadata: Metadata = {
  title: "BeTrack — BearingPoint Transformation Platform",
  description: "Plateforme de pilotage de transformation — savings, leviers, workstreams.",
  manifest: assetPath("/manifest.webmanifest"),
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BeTrack",
  },
  icons: {
    apple: assetPath("/brand/app-icon-180.png"),
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // La zone sous l'encoche iPhone (safe areas) est peinte par l'app, pas par le navigateur —
  // indispensable en mode standalone avec status bar translucide.
  viewportFit: "cover",
  themeColor: "#000000",
};

// RoleProvider/ToastProvider/FilterProvider vivent ici (racine) plutôt que dans AppShell :
// /login en a besoin aussi, et AppShell n'enrobe désormais que les routes protégées.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className={`${hanken.variable} ${splineMono.variable} font-sans antialiased`}>
        <I18nProvider>
          <RoleProvider>
            <ToastProvider>
              <FilterProvider>{children}</FilterProvider>
            </ToastProvider>
          </RoleProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
