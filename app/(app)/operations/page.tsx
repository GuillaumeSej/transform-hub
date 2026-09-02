"use client";

import { Placeholder } from "@/components/shared/Placeholder";
import { useTranslation } from "@/lib/i18n/useTranslation";

export default function OperationsPage() {
  const { t } = useTranslation();
  return (
    <Placeholder
      title={t("nav.operationsModule", "Operations Module")}
      description={t(
        "operations.placeholderDescription",
        "KPIs industriels (TRS, taux de rebut, cadence) par ligne de production, liés aux leviers Operations. Module STRETCH, prochaine passe de développement."
      )}
    />
  );
}
