/* ==========================================================================
   Reports.jsx — the full Reports page: 14 tab types, per-company export,
   Excel export with a formatted banner, and clean print output.
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { api } from "../api/client";
import { PageHeader, Button, Th, EmptyRow, TableWrap, inputCls, selectCls } from "../components/ui";

const TABS = [
  { id: "sales",              label: "Monthly Sales Report" },
  { id: "purchases",          label: "Monthly Purchase Report" },
  { id: "transactions",       label: "Monthly Transaction Report" },
  { id: "office",             label: "Monthly Office Expense Report" },
  { id: "demolition",         label: "Monthly Demolition Report" },
  { id: "customer-statement", label: "Buyer Statement (by Customer)", needsCustomer: true },
  { id: "supplier-statement", label: "Supplier Statement (by Supplier)", needsSupplier: true },
  { id: "all-customers",      label: "All Buyers Report" },
  { id: "all-suppliers",      label: "All Sellers Report" },
  { id: "transportation",     label: "Transportation Report" },
  { id: "inventory",          label: "Stock Report" },
  { id: "ledger",             label: "Outstanding Balances Report" },
  { id: "company-summary",    label: "Company-wise Summary Report" },
  { id: "profit",             label: "Profit & Loss Summary" },
];

const COMPANY_SPLITTABLE = ["sales", "purchases", "transactions", "office", "demolition"];

export default function Reports() {
  const now = new Date();
  const [tab, setTab] = useState("sales");
  const [year, setYear] = useState(now.getFullYear() + 57); // rough BS year
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [company, setCompany] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [supplierId, setSupplierId] = useState("");

  const [report, setReport] = useState({ title: "", summary: [], headers: [], rows: [] });
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const currentTab = TABS.find(t => t.id === tab);

  // Load reference lists once.
  useEffect(() => {
    Promise.all([
      api.get("/api/customers"),
      api.get("/api/suppliers"),
    ]).then(([c, s]) => {
      setCustomers(c.items);
      setSuppliers(s.items);
      if (c.items[0] && !customerId) setCustomerId(c.items[0].id);
      if (s.items[0] && !supplierId) setSupplierId(s.items[0].id);
    }).catch(() => {});

    // Build a company list from what exists on records — safe to attempt.
    // If the endpoint errors, we just show "All companies".
    setCompanies([]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the current report whenever any filter or tab changes.
  useEffect(() => {
    if (currentTab.needsCustomer && !customerId) return;
    if (currentTab.needsSupplier && !supplierId) return;

    setLoading(true); setError(null);

    const q = new URLSearchParams();
    if (year)  q.set("year", year);
    if (month) q.set("month", month);
    if (day)   q.set("day", day);
    if (company) q.set("company", company);
    if (currentTab.needsCustomer) q.set("customerId", customerId);
    if (currentTab.needsSupplier) q.set("supplierId", supplierId);

    api.get(`/api/reports/${tab}?${q.toString()}`)
      .then(data => setReport({
        title: data.title || currentTab.label,
        summary: data.summary || [],
        headers: data.headers || [],
        rows: data.rows || [],
      }))
      .catch(e => setError(e.message || "Failed to load report"))
      .finally(() => setLoading(false));
  }, [tab, year, month, day, company, customerId, supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* -------------------------------------------------------------------------
     Excel export — single sheet
     ------------------------------------------------------------------------- */
  function buildSheet(title, summary, headers, rows, branchLabel) {
    const aoa = [];
    const merges = [];
    const cols = Math.max(headers.length, 2);

    const banner = [
      "ASN Demolition Pvt.Ltd",
      branchLabel ? `Company: ${branchLabel}` : null,
      title,
      `Year: ${year || "All"}${month ? ` · Month: ${month}` : ""}${day ? ` · Day: ${day}` : ""}`,
      `Generated: ${new Date().toLocaleString()}`,
    ].filter(Boolean);
    banner.forEach(line => {
      aoa.push([line]);
      merges.push({ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: cols - 1 } });
    });
    aoa.push([]);

    if (summary.length) {
      summary.forEach(s => aoa.push([s.label, s.value]));
      aoa.push([]);
    }

    aoa.push(headers);
    rows.forEach(r => aoa.push(r));

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet["!merges"] = merges;
    sheet["!cols"] = headers.map((h, i) => {
      const longest = Math.max(String(h).length, ...rows.map(r => String(r[i] ?? "").length), 0);
      return { wch: Math.min(Math.max(longest + 2, 10), 42) };
    });
    return sheet;
  }

  function exportExcel() {
    if (!report.rows.length) { alert("No data to export."); return; }
    const wb = XLSX.utils.book_new();
    const sheet = buildSheet(report.title, report.summary, report.headers, report.rows, company || null);
    XLSX.utils.book_append_sheet(wb, sheet, report.title.slice(0, 31));
    XLSX.writeFile(wb, `${slug(report.title)}_${stamp()}.xlsx`);
  }

  async function exportExcelByCompany() {
    if (!COMPANY_SPLITTABLE.includes(tab)) {
      alert("This report isn't tagged by company. Use Export to Excel instead.");
      return;
    }
    const list = companies.length ? companies : ["ASN Demolition Pvt.Ltd"];
    const wb = XLSX.utils.book_new();
    let added = 0;

    for (const co of list) {
      const q = new URLSearchParams();
      if (year)  q.set("year", year);
      if (month) q.set("month", month);
      if (day)   q.set("day", day);
      q.set("company", co);
      try {
        const data = await api.get(`/api/reports/${tab}?${q.toString()}`);
        if (!data.rows?.length) continue;
        const sheet = buildSheet(data.title || currentTab.label, data.summary || [], data.headers || [], data.rows || [], co);
        XLSX.utils.book_append_sheet(wb, sheet, co.slice(0, 31));
        added++;
      } catch { /* skip empty companies */ }
    }

    if (!added) { alert("No company data in the selected period."); return; }
    XLSX.writeFile(wb, `${slug(report.title)}_by_company_${stamp()}.xlsx`);
  }

  function printReport() {
    window.print();
  }

  /* -------------------------------------------------------------------------
     Render
     ------------------------------------------------------------------------- */
    return (
    <>
      {/* Print-only header — visible only when printing */}
      <div className="print-only">
        <h1>ASN Demolition Pvt.Ltd</h1>
        <div className="meta">
          <strong>{report.title}</strong> · Period: {year || "All"}{month ? ` / ${month}` : ""}{day ? ` / ${day}` : ""}
        </div>
      </div>
    
      {/* Everything below is hidden in print */}
      <div className="print-hidden">
        <PageHeader
          title="Reports"
          description="Every report the business needs, for the selected period — pick a tab, export, or print"
        />
  
        <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded-md p-2.5 mb-6">
          <label className="text-xs text-ink-faint pl-1">Year</label>
          <input type="number" value={year} onChange={e => setYear(e.target.value)} className={inputCls + " !w-24"} />
          <label className="text-xs text-ink-faint pl-1">Month</label>
          <select value={month} onChange={e => setMonth(e.target.value)} className={selectCls + " !w-32"}>
            <option value="">All months</option>
            {["Baisakh","Jestha","Ashar","Shrawan","Bhadra","Ashwin","Kartik","Mangsir","Poush","Magh","Falgun","Chaitra"]
              .map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <label className="text-xs text-ink-faint pl-1">Day</label>
          <input type="number" min="1" max="32" value={day} onChange={e => setDay(e.target.value)} className={inputCls + " !w-20"} placeholder="All" />
          <label className="text-xs text-ink-faint pl-1">Company</label>
          <select value={company} onChange={e => setCompany(e.target.value)} className={selectCls + " !w-48"}>
            <option value="">All companies</option>
            {companies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
            
        <div className="flex gap-2 flex-wrap mb-5">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-2 text-[13px] font-medium border transition-all ${
                tab === t.id
                  ? "bg-steel-dark border-steel-dark text-white"
                  : "bg-surface border-line text-ink-soft hover:border-ink-faint hover:text-ink"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
        
      {/* Report card — visible both on screen and in print */}
      <div className="report-card bg-surface border border-line rounded-md shadow-card p-5">
        {/* Screen-only title + actions */}
        <div className="flex items-start justify-between flex-wrap gap-2.5 mb-4 print-hidden">
          <div>
            <h3 className="text-base font-semibold m-0">{report.title}</h3>
            <p className="text-[12.5px] text-ink-faint mt-0.5">
              Period: {year || "All"}{month ? ` / ${month}` : ""}{day ? ` / ${day}` : ""}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {currentTab.needsCustomer && (
              <select value={customerId} onChange={e => setCustomerId(e.target.value)} className={selectCls + " !w-56"}>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {currentTab.needsSupplier && (
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={selectCls + " !w-56"}>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <Button onClick={exportExcel}>Export to Excel</Button>
            <Button onClick={exportExcelByCompany}>Export by Company</Button>
            <Button onClick={printReport}>Print Report</Button>
          </div>
        </div>
          
        {/* Summary — screen grid, print row of cells */}
        {report.summary.length > 0 && (
          <div className="report-summary grid grid-cols-4 gap-3 mb-4 max-[980px]:grid-cols-2 max-[520px]:grid-cols-1">
            {report.summary.map((s, i) => (
              <div key={i} className="bg-surface-sunken border border-line-soft rounded-sm px-3.5 py-[13px]">
                <div className="label text-[11.5px] text-ink-faint mb-1.5">{s.label}</div>
                <div className="value text-base font-semibold tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>
        )}
  
        {error && (
          <div className="my-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
            {error}
          </div>
        )}
        {loading ? (
          <div className="text-ink-faint text-sm py-8 text-center">Loading report…</div>
        ) : (
          <TableWrap>
            <table className="report-table w-full border-collapse min-w-[640px]">
              <thead>
                <tr>
                  {report.headers.map((h, i) => <Th key={i}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {report.rows.length === 0 && (
                  <EmptyRow colSpan={Math.max(report.headers.length, 1)}>
                    No data for the selected filters.
                  </EmptyRow>
                )}
                {report.rows.map((row, ri) => (
                  <tr key={ri} className="transition-colors hover:bg-surface-sunken">
                    {row.map((cell, ci) => (
                      <td key={ci}
                        className={`px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap ${
                          /Rs\.|kg|%$/.test(String(cell)) ? "text-right tabular-nums" : ""
                        }`}>
                        {cell === "" ? "" : (cell ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>
    </>
  );
}

function slug(s) { return s.replace(/[^a-z0-9]+/gi, "_"); }
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}