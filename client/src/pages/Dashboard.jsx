import { useEffect, useState } from "react";
import { api } from "../api/client";
import { NEPALI_MONTHS_EN } from "../lib/nepali-date";

export default function Dashboard() {
  const now = new Date();
  const [year, setYear]   = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay]     = useState("");

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams();
    if (year)  q.set("year",  year);
    if (month) q.set("month", month);
    if (day)   q.set("day",   day);

    api.get(`/api/reports/dashboard-summary?${q.toString()}`)
      .then(setSummary)
      .catch((e) => setError(e.message || "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [year, month, day]);

  const periodLabel =
    year || month || day
      ? [day, month ? NEPALI_MONTHS_EN[Number(month) - 1] : null, year]
          .filter(Boolean)
          .join(" / ")
      : "All time";

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight m-0">Dashboard</h1>
        <p className="mt-1 mb-0 text-ink-soft text-[13.5px]">
          Business overview for the selected period
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded-md p-2.5 mb-6">
        <label className="text-xs text-ink-faint pl-1">Year</label>
        <input
          type="number"
          min="2000" max="2200"
          placeholder="All"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="text-[13.5px] text-ink bg-surface-sunken border border-line rounded-sm px-[11px] py-[9px] focus:border-steel focus:bg-surface focus:outline-none w-24"
        />
        <label className="text-xs text-ink-faint pl-1">Month</label>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="text-[13.5px] text-ink bg-surface-sunken border border-line rounded-sm px-[11px] py-[9px] focus:border-steel focus:bg-surface focus:outline-none w-36 cursor-pointer"
        >
          <option value="">All months</option>
          {NEPALI_MONTHS_EN.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <label className="text-xs text-ink-faint pl-1">Day</label>
        <input
          type="number"
          min="1" max="32"
          placeholder="All"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="text-[13.5px] text-ink bg-surface-sunken border border-line rounded-sm px-[11px] py-[9px] focus:border-steel focus:bg-surface focus:outline-none w-20"
        />
        <span className="ml-auto text-[12.5px] text-ink-soft pr-1">
          Showing <strong className="text-ink font-semibold">{periodLabel}</strong>
        </span>
      </div>

      {error && (
        <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="mb-9 grid grid-cols-4 gap-3.5 max-[980px]:grid-cols-2 max-[520px]:grid-cols-1">
        {loading && !summary && (
          <div className="col-span-4 text-ink-faint text-sm">Loading…</div>
        )}
        {summary?.cards?.map((c, i) => (
          <div key={i} className="bg-surface border border-line rounded-md shadow-card px-[18px] py-4">
            <div className="text-xs text-ink-faint mb-2">{c.label}</div>
            <div className="text-[21px] font-semibold tracking-tight tabular-nums">{c.value}</div>
            <div className="mt-[7px] text-xs text-ink-faint">{c.meta}</div>
          </div>
        ))}
      </div>

      {/* Recent table */}
      <div className="mb-9">
        <div className="flex items-baseline justify-between gap-3 mb-3.5">
          <h2 className="text-[15.5px] font-semibold tracking-tight m-0">Recent Transactions</h2>
          <span className="text-ink-faint text-[12.5px]">Latest sales and purchases</span>
        </div>
        <div className="overflow-x-auto border border-line rounded-md bg-surface">
          <table className="w-full border-collapse min-w-[640px]">
            <thead>
              <tr>
                {["Date", "Type", "Party", "Product", "Quantity", "Amount", "Status"].map((h) => (
                  <th
                    key={h}
                    className={`text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold px-4 py-[11px] border-b border-line whitespace-nowrap ${
                      ["Quantity", "Amount"].includes(h) ? "text-right tabular-nums" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!summary?.recent?.length && !loading && (
                <tr>
                  <td colSpan={7} className="text-center text-ink-faint py-7">
                    No transactions yet.
                  </td>
                </tr>
              )}
              {(summary?.recent || []).map((r, i) => (
                <tr key={`${r.type}-${r.id}-${i}`} className="transition-colors hover:bg-surface-sunken">
                  <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap np">
                    {r.dateBs}
                  </td>
                  <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-[9px] py-[3px] rounded-full text-[11.5px] font-semibold ${
                        r.type === "Sale" ? "bg-surface-sunken text-ink-soft" : "bg-warning-tint text-warning"
                      }`}
                    >
                      {r.type}
                    </span>
                  </td>
                  <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap">{r.party}</td>
                  <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap">{r.product}</td>
                  <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap text-right tabular-nums">
                    {r.qty}
                  </td>
                  <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap text-right tabular-nums">
                    {r.amount}
                  </td>
                  <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-[9px] py-[3px] rounded-full text-[11.5px] font-semibold ${
                        r.status === "Delivered"
                          ? "bg-positive-tint text-positive"
                          : "bg-warning-tint text-warning"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}