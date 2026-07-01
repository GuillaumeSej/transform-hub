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
};

export default nextConfig;
