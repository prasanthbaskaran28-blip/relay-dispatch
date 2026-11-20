import type { ReactNode } from "react";
import EmptyState from "./EmptyState";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export default function DataTable<T extends { id: string }>({
  columns,
  rows,
  emptyTitle = "No records found",
  emptyDescription = "Try adjusting your filters or check back later.",
}: {
  columns: Column<T>[];
  rows: T[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            {columns.map((column) => (
              <th className={`px-5 py-3.5 font-semibold ${column.className ?? ""}`} key={column.key}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr className="hover:bg-slate-50/70" key={row.id}>
              {columns.map((column) => (
                <td className={`px-5 py-4 text-ink ${column.className ?? ""}`} key={column.key}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
