import { mockData } from "@/data/mockData";
import LeverDetailClient from "./LeverDetailClient";

// Requis pour l'export statique (GitHub Pages) : chaque route /levers/[id] doit être
// connue au build. Les leviers créés/modifiés en session restent accessibles car
// LeverDetailClient lit ensuite l'id réel depuis localStorage, pas depuis ce mock.
export function generateStaticParams() {
  return mockData.levers.map((lever) => ({ id: lever.id }));
}

export default function LeverDetailPage({ params }: { params: { id: string } }) {
  return <LeverDetailClient id={params.id} />;
}
