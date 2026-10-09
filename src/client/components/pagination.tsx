import { ChevronLeft, ChevronRight } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import type { PaginatedState } from "../types";

interface Props {
  pag: PaginatedState;
  setPage: (page: number) => void;
}

export function Pagination({ pag, setPage }: Props) {
  const { t } = useI18n();
  const totalPages = Math.max(1, Math.ceil(pag.total / pag.limit));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      <Button variant="outline" size="icon" aria-label={t("pagination.precedente")} disabled={pag.page <= 1} onClick={() => setPage(pag.page - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm text-muted-foreground">{t("pagination.page", { page: pag.page, total: totalPages })}</span>
      <Button variant="outline" size="icon" aria-label={t("pagination.suivante")} disabled={pag.page >= totalPages} onClick={() => setPage(pag.page + 1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
