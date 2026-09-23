/* ==========================================================================
   DataTable — table shell + client-side pagination.
   `columns` = [{ key, label, numeric?, render?(row) }]
   `rows`    = the full already-filtered array for the current view
   ========================================================================== */
import { useState, useEffect } from "react";
import { TableWrap, Th, EmptyRow } from "./ui";

const PAGE_SIZE = 15;

export default function DataTable({
  columns,
  rows,
  onRowClick,
  emptyMessage = "No records found.",
  rowKey = (r) => r.id,
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  // Reset to page 1 whenever the underlying dataset changes size.
  useEffect(() => { setPage(1); }, [rows.length]);

  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);

  return (
    <>
      <TableWrap>
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr>
              {columns.map((c) => (
                <Th key={c.key} numeric={c.numeric}>{c.label}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <EmptyRow colSpan={columns.length}>{emptyMessage}</EmptyRow>
            )}
            {visible.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`transition-colors hover:bg-surface-sunken ${onRowClick ? "cursor-pointer" : ""}`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap ${
                      c.numeric ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      {totalPages > 1 && (
        <div className="flex items-center justify-between flex-wrap gap-2.5 mt-3 max-[560px]:flex-col max-[560px]:items-start">
          <span className="text-[12.5px] text-ink-faint">
            Showing {start + 1}–{Math.min(rows.length, start + PAGE_SIZE)} of {rows.length}
          </span>
          <div className="flex items-center gap-1">
            <PageBtn onClick={() => setPage(safePage - 1)} disabled={safePage === 1}>‹</PageBtn>
            {pageNumbers(safePage, totalPages).map((p, i) =>
              p === "..." ? (
                <span key={`e${i}`} className="text-ink-faint text-[12.5px] px-0.5">…</span>
              ) : (
                <PageBtn key={p} onClick={() => setPage(p)} active={p === safePage}>{p}</PageBtn>
              )
            )}
            <PageBtn onClick={() => setPage(safePage + 1)} disabled={safePage === totalPages}>›</PageBtn>
          </div>
        </div>
      )}
    </>
  );
}

function PageBtn({ children, onClick, disabled, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-w-[28px] h-7 px-1.5 rounded-sm text-[12.5px] font-medium inline-flex items-center justify-center transition-all ${
        active
          ? "bg-steel-dark border border-steel-dark text-white"
          : "bg-surface border border-line text-ink-soft hover:border-ink-faint hover:text-ink"
      } disabled:opacity-40 disabled:cursor-default`}
    >
      {children}
    </button>
  );
}

function pageNumbers(current, total) {
  const out = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - current) <= 2) out.push(i);
  }
  const withDots = [];
  let prev = 0;
  out.forEach((p) => {
    if (prev && p - prev > 1) withDots.push("...");
    withDots.push(p);
    prev = p;
  });
  return withDots;
}