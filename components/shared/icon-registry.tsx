import {
  BarChart3,
  Factory,
  FlaskConical,
  History,
  Layers,
  ListChecks,
  MessageCircle,
  PieChart,
  Target,
  TriangleAlert,
  Users,
  LineChart,
  type LucideIcon,
} from "lucide-react";

/** Registre d'icônes utilisé par la nav (lib/nav-config.ts référence ces noms en string). */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  PieChart,
  Layers,
  Target,
  FlaskConical,
  BarChart3,
  TriangleAlert,
  ListChecks,
  MessageCircle,
  LineChart,
  History,
  Users,
  Factory,
};
