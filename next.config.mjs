// GitHub Pages sert le repo sous /transform-hub/ (project pages) — basePath/assetPrefix
// ne s'appliquent qu'au build de déploiement (GITHUB_PAGES=true dans le workflow CI),
// jamais en dev local ni sur un déploiement type Vercel.
const isGithubPagesBuild = process.env.GITHUB_PAGES === "true";
const basePath = isGithubPagesBuild ? "/transform-hub" : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath,
  images: { unoptimized: true },
  // pptxgenjs (export PowerPoint du dashboard, voir DashboardExportButton) référence
  // conditionnellement des modules Node ("fs", "https", "http") pour son usage côté serveur —
  // jamais exécuté dans notre cas (100% client), mais webpack a quand même besoin de les
  // résoudre pour le bundle navigateur. On les neutralise ici plutôt que de laisser ça casser
  // le build statique.
  webpack: (config, { webpack }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      https: false,
      http: false,
    };
    // Le fallback ci-dessus ne couvre que les imports "fs"/"https" nus — pptxgenjs importe la
    // forme préfixée "node:fs"/"node:https" (schéma non géré nativement par webpack), qu'il faut
    // d'abord ramener à la forme sans préfixe pour que le fallback ci-dessus s'applique.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, "");
      })
    );
    return config;
  },
};

export default nextConfig;
