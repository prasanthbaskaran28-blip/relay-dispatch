import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
      <span>Page {page} of {Math.max(totalPages, 1)}</span>
      <div className="flex gap-2">
        <button aria-label="Previous page" className="icon-button" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={16} />
        </button>
        <button aria-label="Next page" className="icon-button" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
