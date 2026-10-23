/* ==========================================================================
   Purchases.jsx — multi-line purchase entry with trip grouping.
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button, Modal, Field, ConfirmDialog, Badge, PageHeader,
  inputCls, selectCls,
} from "../components/ui";
import DataTable from "../components/DataTable";
import { printVoucher } from "../lib/printVoucher";
import {
  bsToday, bsToAdString, formatBs,
  NEPALI_MONTHS, NEPALI_MONTHS_EN,
} from "../lib/nepali-date";

const BRAND = "ScrapLink Pvt.Ltd";
const todayBs = bsToday();

const emptyLine = () => ({
  invoice: "",
  supplier_id: "",
  material: "",
  gross_qty: "",
  dust_qty: "0",
  rate: "",
  labor_charge: "0",
  contact_person: "",
  contact_phone: "",
  status: "Delivered",
  amount_paid: "0",
  payment_method: "Cash",
});

const EMPTY_HEADER = {
  date_bs_year:  todayBs.year,
  date_bs_month: todayBs.month,
  date_bs_day:   todayBs.day,
  date_ad:       bsToAdString(todayBs),
  status:        "Delivered",
  company:       BRAND,
  
  // Transport fields (restored)
  truck_no:           "",
  truck_weight_kg:    "",
  truck_driver:       "",
  truck_driver_phone: "",
  from_location:      "",
  to_location:        "",
  loader_name:        "",
  transport_fee:      "0",
  road_expense:       "0",
  tax_gbse:           "0",
};

const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const rupees = (v) => `Rs. ${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const kg = (v) => `${num(v).toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
const adStr = (r) => (r.date_ad ? String(r.date_ad).slice(0, 10) : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
);

const AD_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function prettyAd(s) {
  if (!s) return "—";
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return s;
  return `${d} ${AD_MONTHS[m - 1]} ${y}`;
}

const BS_MONTH_LENGTHS = {
  2070:[31,31,31,32,31,31,29,30,30,29,30,30],
  2071:[31,31,32,31,31,31,30,29,30,29,30,30],
  2072:[31,32,31,32,31,30,30,29,30,29,30,30],
  2073:[31,32,31,32,31,30,30,30,29,29,30,31],
  2074:[31,31,31,32,31,31,30,29,30,29,30,30],
  2075:[31,31,32,31,31,31,30,29,30,29,30,30],
  2076:[31,32,31,32,31,30,30,30,29,29,30,30],
  2077:[31,32,31,32,31,30,30,30,29,30,29,31],
  2078:[31,31,31,32,31,31,30,29,30,29,30,30],
  2079:[31,31,32,31,31,31,30,29,30,29,30,30],
  2080:[31,32,31,32,31,30,30,30,29,29,30,30],
  2081:[31,32,31,32,31,30,30,30,29,30,29,31],
  2082:[31,31,32,31,31,31,30,29,30,29,30,30],
  2083:[31,31,32,31,31,31,30,29,30,29,30,30],
  2084:[31,32,31,32,31,30,30,30,29,29,30,31],
  2085:[30,32,31,32,31,30,30,30,29,30,29,31],
  2086:[31,31,32,31,31,31,30,29,30,29,30,30],
  2087:[31,31,32,31,31,31,30,30,29,30,30,30],
  2088:[30,31,32,32,30,31,30,30,29,30,30,30],
  2089:[30,32,31,32,31,30,30,30,29,30,30,30],
};
function daysInBsMonth(year, month) {
  const lengths = BS_MONTH_LENGTHS[year] || BS_MONTH_LENGTHS[2083];
  return lengths[month - 1] || 30;
}

const lineComputed = (line) => {
  const gross = num(line.gross_qty);
  const dust  = num(line.dust_qty);
  const net   = Math.max(0, gross - dust);   
  const rate  = num(line.rate);
  const labor = num(line.labor_charge);
  const base  = net * rate;
  const total = base + labor;
  const due   = Math.max(0, total - num(line.amount_paid));
  return { gross, dust, net, rate, labor, base, total, due };
};

const nextInvoiceFrom = (invoices) => {
  const max = invoices.reduce((m, inv) => {
    const match = /^PUR-(\d+)/.exec(inv || "");
    return match ? Math.max(m, parseInt(match[1], 10)) : m;
  }, 0);
  return `PUR-${String(max + 1).padStart(4, "0")}`;
};

function makeUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function Purchases() {
  const { has, canDelete } = useAuth();
  const canCreate = has("purchases", "create");
  const canUpdate = has("purchases", "update");
  const canDel    = canDelete("purchases");

  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [tripId, setTripId] = useState(null);
  const [header, setHeader] = useState(EMPTY_HEADER);
  const [lines, setLines] = useState([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [detail, setDetail] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, s] = await Promise.all([
        api.get("/api/purchases"),
        api.get("/api/suppliers"),
      ]);
      setRows(p.items || []);
      setSuppliers(s.items || []);
    } catch (e) {
      setError(e.message || "Failed to load purchases");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!showForm) return;
    const y = Number(header.date_bs_year);
    const m = Number(header.date_bs_month);
    const d = Number(header.date_bs_day);
    if (!y || !m || !d) return;
    try {
      const s = bsToAdString({ year: y, month: m, day: d });
      if (s !== header.date_ad) setHeader((h) => ({ ...h, date_ad: s }));
    } catch { /* invalid */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.date_bs_year, header.date_bs_month, header.date_bs_day, showForm]);

  const supplierNameById = useMemo(() => {
    const m = new Map();
    suppliers.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [suppliers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (supplierFilter && String(r.supplier_id) !== supplierFilter) return false;
      if (!q) return true;
      return (
        (r.invoice || "").toLowerCase().includes(q) ||
        (r.material || "").toLowerCase().includes(q) ||
        (supplierNameById.get(r.supplier_id) || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, supplierFilter, supplierNameById]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const qty   = rows.reduce((s, r) => s + num(r.net_qty), 0);
    const laborTotal = rows.reduce((s, r) => s + num(r.labor_charge), 0);
    const delivered = rows.filter((r) => r.status === "Delivered").length;
    return [
      { label: "Total Purchases", value: rupees(total) },
      { label: "Steel Purchased", value: kg(qty) },
      { label: "Labor Total",     value: rupees(laborTotal) },
      { label: "Delivered",       value: `${delivered} / ${rows.length}` },
    ];
  }, [rows]);

  function openCreate() {
    setEditing(null);
    setTripId(makeUuid());
    setHeader({ ...EMPTY_HEADER });
    const existingInvoices = rows.map((r) => r.invoice);
    const first = {
      ...emptyLine(),
      invoice: nextInvoiceFrom(existingInvoices),
      supplier_id: suppliers[0]?.id || "",
    };
    setLines([first]);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(row) {
    setEditing(row);
    setTripId(row.trip_id || null);
    setHeader({
      date_bs_year:  row.date_bs_year  || todayBs.year,
      date_bs_month: row.date_bs_month || todayBs.month,
      date_bs_day:   row.date_bs_day   || todayBs.day,
      date_ad:       row.date_ad ? String(row.date_ad).slice(0, 10) : bsToAdString(todayBs),
      status:        row.status || "Delivered",
      company:       row.company || BRAND,
      
      // Restore transport fields on edit
      truck_no:           row.truck_no || "",
      truck_weight_kg:    row.truck_weight_kg ?? "",
      truck_driver:       row.truck_driver || "",
      truck_driver_phone: row.truck_driver_phone || "",
      from_location:      row.from_location || "",
      to_location:        row.to_location || "",
      loader_name:        row.loader_name || "",
      transport_fee:      row.transport_fee ?? "0",
      road_expense:       row.road_expense ?? "0",
      tax_gbse:           row.tax_gbse ?? "0",
    });
    setLines([{
      invoice: row.invoice || "",
      supplier_id: row.supplier_id || "",
      material: row.material || "",
      gross_qty: row.gross_qty ?? "",
      dust_qty:  row.dust_qty  ?? "0",
      rate:      row.rate      ?? "",
      labor_charge:  row.labor_charge  ?? "0",
      contact_person: row.contact_person || "",
      contact_phone:  row.contact_phone  || "",
      status:  row.status || "Delivered",
      amount_paid: "0",
      payment_method: "Cash",
    }]);
    setFormError(null);
    setShowForm(true);
  }

  function addLine() {
    setLines((ls) => {
      const all = [...rows.map((r) => r.invoice), ...ls.map((l) => l.invoice)];
      const next = nextInvoiceFrom(all);
      return [...ls, { ...emptyLine(), invoice: next, supplier_id: suppliers[0]?.id || "" }];
    });
  }
  function removeLine(i) {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));
  }
  function patchLine(i, patch) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const c = lineComputed(l);
      if (!l.invoice.trim())   { setFormError(`Line ${i + 1}: invoice is required.`);   setSaving(false); return; }
      if (!l.supplier_id)      { setFormError(`Line ${i + 1}: select a supplier.`);     setSaving(false); return; }
      if (!l.material.trim())  { setFormError(`Line ${i + 1}: material is required.`);  setSaving(false); return; }
      if (c.gross <= 0)        { setFormError(`Line ${i + 1}: gross qty must be > 0.`); setSaving(false); return; }
      if (c.rate <= 0)         { setFormError(`Line ${i + 1}: rate must be > 0.`);      setSaving(false); return; }
      if (l.contact_phone && !/^\d{10}$/.test(l.contact_phone)) {
        setFormError(`Line ${i + 1}: phone must be exactly 10 digits.`);
        setSaving(false); return;
      }
    }

    const baseHeader = {
      date_bs_year:  Number(header.date_bs_year),
      date_bs_month: Number(header.date_bs_month),
      date_bs_day:   Number(header.date_bs_day),
      date_ad:       header.date_ad,
      company:       header.company.trim() || undefined,
      
      // Restore transport fields to payload
      truck_no:           header.truck_no.trim() || null,
      truck_weight_kg:    num(header.truck_weight_kg) || null,
      truck_driver:       header.truck_driver.trim() || null,
      truck_driver_phone: header.truck_driver_phone.trim() || null,
      from_location:      header.from_location.trim() || null,
      to_location:        header.to_location.trim() || null,
      loader_name:        header.loader_name.trim() || null,
      transport_fee:      num(header.transport_fee),
      road_expense:       num(header.road_expense),
      tax_gbse:           num(header.tax_gbse),
      
      trip_id:       tripId,
    };

    const linePayload = (l) => {
      const c = lineComputed(l);
      return {
        ...baseHeader,
        invoice:     l.invoice.trim(),
        supplier_id: Number(l.supplier_id),
        material:    l.material.trim(),
        gross_qty:   c.gross,
        dust_qty:    c.dust,
        net_qty:     c.net,
        rate:        c.rate,
        labor_charge: c.labor,
        total:       c.total,
        contact_person: l.contact_person.trim() || undefined,
        contact_phone:  l.contact_phone.trim()  || undefined,
        status: l.status,
      };
    };

    try {
      if (editing) {
        await api.patch(`/api/purchases/${editing.id}`, linePayload(lines[0]));
      } else {
        const payloads = lines.map((l) => {
          const p = linePayload(l);
          p.amount_paid    = num(l.amount_paid);
          p.payment_method = l.payment_method;
          return p;
        });
        await api.post("/api/purchases/batch", { lines: payloads });
      }

      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save purchase");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/purchases/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete purchase");
    } finally {
      setDeleting(false);
    }
  }

  async function fetchPaymentsForPurchase(id) {
    try {
      const { items } = await api.get("/api/transactions");
      return (items || []).filter(
        (t) => t.ref_type === "purchase" && Number(t.ref_id) === Number(id)
      );
    } catch { return []; }
  }

  async function printPurchaseInvoice(row) {
    const company = row.company || BRAND;
    const tripRows = row.trip_id 
      ? rows.filter(r => r.trip_id === row.trip_id) 
      : [row];

    // Fetch payments for all rows in the trip
    const allPayments = (await Promise.all(
      tripRows.map(r => fetchPaymentsForPurchase(r.id))
    )).flat();

    const paidTotal = allPayments.reduce((s, p) => s + num(p.amount), 0);
    const grandTotal = tripRows.reduce((s, r) => s + num(r.total), 0);
    const due = Math.max(0, grandTotal - paidTotal);

    // Build a separate box for each supplier
    const supplierBoxes = tripRows.map((r, idx) => {
      const rBase = num(r.net_qty) * num(r.rate);
      const rLabor = num(r.labor_charge);
      const rPaid = allPayments.filter(p => Number(p.ref_id) === Number(r.id))
                               .reduce((s, p) => s + num(p.amount), 0);
      
      return `
        <div class="doc-supplier-box" style="border: 1px solid #999; padding: 10px; margin-bottom: 15px; page-break-inside: avoid;">
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-bottom: 10px;">
            <div>
              <div style="font-size: 9.5px; text-transform: uppercase; color: #555;">Supplier ${idx + 1} of ${tripRows.length} · ${esc(r.invoice)}</div>
              <div style="font-size: 14px; font-weight: bold;">${esc(supplierNameById.get(r.supplier_id) || "—")}</div>
              ${(r.contact_person || r.contact_phone) ? `<div style="font-size: 10.5px; color: #444;">${esc([r.contact_person, r.contact_phone].filter(Boolean).join(" · "))}</div>` : ""}
            </div>
            <div style="text-align: right; font-size: 10px;">
              <div>${esc(formatBs(r))}</div>
              <div>${esc(adStr(r))}</div>
              <div>${esc(r.status)}</div>
            </div>
          </div>
          
          <table class="doc-table">
            <thead>
              <tr>
                <th>Material</th>
                <th class="num">Gross Qty</th>
                <th class="num">Dust (KG)</th>
                <th class="num">Net Qty</th>
                <th class="num">Rate / kg</th>
                <th class="num">Product Amount</th>
                <th class="num">Labor</th>
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${esc(r.material || "—")}</td>
                <td class="num">${esc(kg(r.gross_qty))}</td>
                <td class="num">-${esc(kg(r.dust_qty))}</td>
                <td class="num">${esc(kg(r.net_qty))}</td>
                <td class="num">${esc(rupees(r.rate))}</td>
                <td class="num">${esc(rupees(rBase))}</td>
                <td class="num">${esc(rupees(rLabor))}</td>
                <td class="num">${esc(rupees(r.total))}</td>
              </tr>
            </tbody>
          </table>

          <div class="doc-summary" style="margin-top: 10px; width: 250px;">
            <div><span>Total Amount</span><span>${esc(rupees(r.total))}</span></div>
            <div><span>Paid</span><span>${esc(rupees(rPaid))}</span></div>
            <div class="doc-summary-strong"><span>Balance Due</span><span>${esc(rupees(Math.max(0, num(r.total) - rPaid)))}</span></div>
          </div>
        </div>
      `;
    }).join("");

    const grandBlock = tripRows.length > 1 ? `
      <div class="doc-summary" style="width: 250px; margin-left: auto; margin-top: 10px;">
        <div><span>All Orders Total</span><span>${esc(rupees(grandTotal))}</span></div>
        <div><span>All Paid</span><span>${esc(rupees(paidTotal))}</span></div>
        <div class="doc-summary-strong"><span>All Balance Due</span><span>${esc(rupees(due))}</span></div>
      </div>` : "";

    // Transportation Details Block (shared across the trip)
    const transportBlock = (row.truck_no) ? `
    ` : "";

    printVoucher(`
      <div class="doc-sheet">
        <div class="doc-letterhead">
          <div class="doc-brand">
            <div class="doc-company">${esc(company)}</div>
          </div>
          <div class="doc-kind">
            <div class="doc-title">Purchase Invoice ${tripRows.length > 1 ? '(Shared Truck)' : ''}</div>
            <div class="doc-no">No. ${esc(tripRows.map(r => r.invoice).join(", "))}</div>
          </div>
        </div>

        <div class="doc-meta">
          <div>Date (BS)<strong>${esc(formatBs(row))}</strong></div>
          <div>Date (English)<strong>${esc(adStr(row))}</strong></div>
          <div>Company<strong>${esc(company)}</strong></div>
          <div>Suppliers<strong>${tripRows.length}</strong></div>
        </div>

        ${supplierBoxes}
        ${grandBlock}
        ${transportBlock}

        <div class="doc-signatures" style="margin-top: 30px;">
          <div>Received By: ${esc(row.signature || '')}</div>
          <div>Authorized By: ${esc(row.paid_by || '')}</div>
        </div>

        <div class="doc-foot">
          Printed on ${esc(new Date().toLocaleString())} from ${esc(company)} management system.
        </div>
      </div>`);
  }

  const columns = [
    { key: "date_bs", label: "Date (BS)", render: (r) => formatBs(r) },
    { key: "date_ad", label: "Date (EN)", render: (r) => adStr(r) },
    { key: "invoice", label: "Invoice" },
    { key: "supplier", label: "Supplier",
      render: (r) => supplierNameById.get(r.supplier_id) || "—" },
    { key: "material", label: "Material" },
    { key: "gross_qty", label: "Gross", numeric: true, render: (r) => kg(r.gross_qty) },
    { key: "dust_qty",  label: "Report", numeric: true, render: (r) => kg(r.dust_qty) },
    { key: "net_qty",   label: "Net",   numeric: true, render: (r) => kg(r.net_qty) },
    { key: "rate",      label: "Rate",  numeric: true, render: (r) => `${rupees(r.rate)}/kg` },
    { key: "labor_charge", label: "Labor", numeric: true,
      render: (r) => rupees(r.labor_charge || 0) },
    { key: "total",     label: "Total", numeric: true, render: (r) => rupees(r.total) },
    { key: "paid_amount", label: "Paid", numeric: true,
      render: (r) => <span className="text-positive">{rupees(r.paid_amount || 0)}</span> },
    { key: "due_amount", label: "Balance", numeric: true,
      render: (r) => {
        const due = r.due_amount || 0;
        return <span className={due > 0 ? "text-negative" : "text-ink-faint"}>{rupees(due)}</span>;
      } },
    { key: "status", label: "Status",
      render: (r) => <Badge variant={r.status === "Delivered" ? "positive" : "warning"}>{r.status}</Badge> },
    { key: "actions", label: "", render: (r) => (
      <div className="flex gap-1.5 justify-end">
        {canUpdate && (
          <button type="button"
            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
            className="text-steel text-xs hover:underline">Edit</button>
        )}
        {canDel && (
          <button type="button"
            onClick={(e) => { e.stopPropagation(); setToDelete(r); }}
            className="text-negative text-xs hover:underline">Delete</button>
        )}
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="Purchases"
        description="Every material purchase — weights, rates, transport and supplier"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ New Purchase</Button> : null}
      />

      <div className="grid grid-cols-4 gap-3 mb-[18px] max-[980px]:grid-cols-2 max-[520px]:grid-cols-1">
        {stats.map((s, i) => (
          <div key={i} className="bg-surface-sunken border border-line-soft rounded-sm px-3.5 py-[13px]">
            <div className="text-[11.5px] text-ink-faint mb-1.5">{s.label}</div>
            <div className="text-base font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded-md p-2.5 mb-6">
        <label htmlFor="pur-search" className="text-xs text-ink-faint pl-1">Search</label>
        <input id="pur-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Invoice, material, supplier" className={inputCls + " !w-64"} />

        <label htmlFor="pur-supplier" className="text-xs text-ink-faint pl-1">Supplier</label>
        <select id="pur-supplier" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <label htmlFor="pur-status" className="text-xs text-ink-faint pl-1">Status</label>
        <select id="pur-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All</option>
          <option value="Delivered">Delivered</option>
          <option value="Pending">Pending</option>
        </select>

        <span className="ml-auto text-[12.5px] text-ink-soft pr-1">
          Showing <strong className="text-ink font-semibold">{filtered.length}</strong>
        </span>
      </div>

      {error && (
        <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-ink-faint text-sm py-8 text-center">Loading purchases…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          onRowClick={(row) => setDetail(row)}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No purchases yet — click "+ New Purchase" to get started.' : "No purchases yet.")
              : "No purchases match the current filter."
          }
        />
      )}

      {detail && (
        <Modal
          title={`Purchase Detail — ${detail.invoice}`}
          onClose={() => setDetail(null)}
          wide
          footer={
            <>
              <Button onClick={() => printPurchaseInvoice(detail)}>
                {detail.trip_id && rows.filter(r => r.trip_id === detail.trip_id).length > 1
                  ? `Print All ${rows.filter(r => r.trip_id === detail.trip_id).length} Orders`
                  : "Print"}
              </Button>
              <Button onClick={() => setDetail(null)}>Close</Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 mb-4 max-[560px]:grid-cols-1">
            <DetailPair label="Paid So Far" value={<span className="text-positive">{rupees(detail.paid_amount || 0)}</span>} />
            <DetailPair label="Balance Due" value={<span className={(detail.due_amount || 0) > 0 ? "text-negative" : "text-ink-faint"}>{rupees(detail.due_amount || 0)}</span>} />
            <DetailPair label="Supplier" value={supplierNameById.get(detail.supplier_id) || "—"} />
            <DetailPair label="Person Name" value={detail.contact_person || "—"} />
            <DetailPair label="Phone Number" value={detail.contact_phone || "—"} />
            <DetailPair label="Company" value={detail.company || "—"} />
            <DetailPair label="Date (BS)" value={formatBs(detail)} />
            <DetailPair label="Date (EN)" value={adStr(detail)} />
            <DetailPair label="Material" value={detail.material || "—"} />
            <DetailPair label="Status" value={detail.status || "—"} />
            <DetailPair label="Gross / Report / Net"
              value={`${kg(detail.gross_qty)} / ${kg(detail.dust_qty)} / ${kg(detail.net_qty)}`} />
            <DetailPair label="Rate" value={`${rupees(detail.rate)}/kg`} />
            <DetailPair label="Product Amount" value={rupees(num(detail.gross_qty) * num(detail.rate))} />
            <DetailPair label="Labor Charge" value={rupees(detail.labor_charge || 0)} />
            <DetailPair label="Total" value={rupees(detail.total)} />
            {detail.truck_no ? <DetailPair label="Truck No." value={detail.truck_no} /> : null}
            {detail.loader_name ? <DetailPair label="Loader" value={detail.loader_name} /> : null}
          </div>
        </Modal>
      )}

      {showForm && (
        <Modal
          title={editing ? `Edit Purchase — ${editing.invoice}` : "New Purchase"}
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button variant="primary" type="submit" form="purchase-form" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Save Purchase"}
              </Button>
            </>
          }
        >
          <form id="purchase-form" onSubmit={save}>
            {formError && (
              <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
                {formError}
              </div>
            )}

            <p className="text-[11.5px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
              Purchased quantity (net, after dust) is added automatically to Inventory if the material name matches an existing item.
              Bought from more than one supplier on the same truck? Use <strong>+ Add Another Purchase</strong> — the header
              (date, status, company, truck, loader) is shared; only the supplier, material, weights and rate are per-line.
            </p>

            {/* ============ SHARED HEADER ============ */}
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Month (BS)">
                <select className={selectCls} value={header.date_bs_month}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    setHeader((h) => {
                      const maxDay = daysInBsMonth(Number(h.date_bs_year), m);
                      return {
                        ...h,
                        date_bs_month: m,
                        date_bs_day: Math.min(Number(h.date_bs_day) || 1, maxDay),
                      };
                    });
                  }}>
                  {NEPALI_MONTHS.map((np, i) => (
                    <option key={i} value={i + 1}>
                      {np} / {NEPALI_MONTHS_EN[i]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Day">
                <select className={selectCls} value={header.date_bs_day}
                  onChange={(e) => setHeader((h) => ({ ...h, date_bs_day: Number(e.target.value) }))}>
                  {Array.from(
                    { length: daysInBsMonth(Number(header.date_bs_year), Number(header.date_bs_month)) },
                    (_, i) => i + 1
                  ).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>

              <Field label="English Date" hint="auto-computed from BS">
                <div className={inputCls + " !bg-surface-sunken text-ink-soft"}>
                  {prettyAd(header.date_ad)}
                </div>
              </Field>
              <Field label="Status">
                <select className={selectCls} value={header.status}
                  onChange={(e) => setHeader((h) => ({ ...h, status: e.target.value }))}>
                  <option value="Delivered">Delivered</option>
                  <option value="Pending">Pending</option>
                </select>
              </Field>

              <Field label="Company">
                <div className={inputCls + " !bg-surface-sunken text-ink-soft"}>
                  {BRAND}
                </div>
              </Field>
              {/* {============== TRUCK NO =============} */}
              <Field label="Truck No.">
                <input className={inputCls} value={header.truck_no}
                  onChange={(e) => setHeader((h) => ({ ...h, truck_no: e.target.value }))}
                  placeholder="BA 1 KHA 1234" />
              </Field>
            </div>
            {/* ============ PURCHASE LINES ============ */}
            {lines.map((line, i) => {
              const c = lineComputed(line);
              return (
                <div key={i} className="border border-line rounded-md p-3.5 mb-4 bg-surface-sunken">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[13px] font-semibold">Purchase {i + 1}</div>
                    {lines.length > 1 && (
                      <button type="button"
                        onClick={() => removeLine(i)}
                        className="text-negative text-xs hover:underline">
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3.5 mb-3.5 max-[560px]:grid-cols-1">
                    <Field label="Invoice #" span={2}>
                      <input className={inputCls} value={line.invoice} required
                        onChange={(e) => patchLine(i, { invoice: e.target.value })} />
                    </Field>

                    <Field label="Supplier" span={2}>
                      <select className={selectCls} value={line.supplier_id} required
                        onChange={(e) => patchLine(i, { supplier_id: e.target.value })}>
                        <option value="">Supplier / company name</option>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Person Name">
                      <input className={inputCls} value={line.contact_person}
                        onChange={(e) => patchLine(i, { contact_person: e.target.value })}
                        placeholder="Person in charge" />
                    </Field>
                    <Field label="Phone Number">
                      <input className={inputCls} value={line.contact_phone}
                        inputMode="numeric" maxLength={10}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                          patchLine(i, { contact_phone: digits });
                        }}
                        placeholder="98XXXXXXXX" />
                    </Field>

                    <Field label="Material" span={2}>
                      <input className={inputCls} value={line.material} required
                        placeholder="e.g. TMT Rod 12mm"
                        onChange={(e) => patchLine(i, { material: e.target.value })} />
                    </Field>

                    <Field label="Gross Quantity (kg)">
                      <input type="number" min="0" step="0.001" className={inputCls} value={line.gross_qty} required
                        onChange={(e) => patchLine(i, { gross_qty: e.target.value })} />
                    </Field>
                    <Field label="Dust (Reported Amount) KG">
                      <input type="number" min="0" step="0.001" className={inputCls} value={line.dust_qty}
                        onChange={(e) => patchLine(i, { dust_qty: e.target.value })} />
                    </Field>
                    <Field label="Net Quantity">
                      <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold"}>
                        {kg(c.net)}
                      </div>
                    </Field>
                    <Field label="Rate (Rs / kg)">
                      <input type="number" min="0" step="0.01" className={inputCls} value={line.rate} required
                        onChange={(e) => patchLine(i, { rate: e.target.value })} />
                    </Field>

                    <Field label="Labor Cost (Rs)" span={2}>
                      <input type="number" min="0" step="0.01" className={inputCls} value={line.labor_charge}
                        onChange={(e) => patchLine(i, { labor_charge: e.target.value })} />
                    </Field>

                    <Field label="Total (product + labor)" span={2}>
                      <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold !text-[15px]"}>
                        {rupees(c.total)}
                      </div>
                    </Field>

                    {!editing && (
                      <>
                        <Field label="Amount Paid Now (Rs)">
                          <input type="number" min="0" step="0.01" className={inputCls} value={line.amount_paid}
                            onChange={(e) => patchLine(i, { amount_paid: e.target.value })} />
                        </Field>
                        <Field label="Cash / Online">
                          <select className={selectCls} value={line.payment_method}
                            onChange={(e) => patchLine(i, { payment_method: e.target.value })}>
                            <option value="Cash">Cash</option>
                            <option value="Online">Online</option>
                          </select>
                        </Field>
                        <Field label="Due After This" span={2}>
                          <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold"}>
                            {rupees(c.due)}
                          </div>
                        </Field>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {!editing && (
              <div className="flex items-center gap-3">
                <Button type="button" onClick={addLine} size="sm">
                  + Add Another Purchase
                </Button>
                <span className="text-[12px] text-ink-faint">
                  Same truck, different supplier? Add it here — the date, status, company, truck and loader are shared.
                </span>
              </div>
            )}
          </form>

          {editing && (
            <div className="mt-5">
              <EditPaymentBlock
                purchase={editing}
                supplierName={supplierNameById.get(editing.supplier_id) || ""}
                onPaid={load}
              />
            </div>
          )}
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete purchase?"
          message={`Delete purchase ${toDelete.invoice}? This can't be undone.`}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}

function DetailPair({ label, value }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink-faint mb-0.5">{label}</div>
      <div className="text-[13.5px] font-medium">{value}</div>
    </div>
  );
}

/* EditPaymentBlock — unchanged from previous version */
function EditPaymentBlock({ purchase, supplierName, onPaid }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);

  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(true);

  async function reloadPayments() {
    setLoadingPayments(true);
    try {
      const { items } = await api.get("/api/transactions");
      setPayments(
        (items || []).filter(
          (t) => t.ref_type === "purchase" && Number(t.ref_id) === Number(purchase.id)
        )
      );
    } catch {
      setPayments([]);
    } finally {
      setLoadingPayments(false);
    }
  }
  useEffect(() => { reloadPayments(); /* eslint-disable-next-line */ }, [purchase.id]);

  const paidSoFar = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const total = Number(purchase.total || 0);
  const due = Math.max(0, total - paidSoFar);

  const bs = {
    year:  purchase.date_bs_year  || 2083,
    month: purchase.date_bs_month || 1,
    day:   purchase.date_bs_day   || 1,
  };
  const ad = purchase.date_ad
    ? String(purchase.date_ad).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  async function submit() {
    setErr(null);
    setDone(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter an amount greater than zero."); return; }
    setBusy(true);
    try {
      const payload = {
        type: "purchase_payment",
        party_type: "supplier",
        party_key: String(purchase.supplier_id),
        direction: "out",
        amount: amt,
        method,
        ref_type: "purchase",
        ref_id: purchase.id,
        date_bs_year:  bs.year,
        date_bs_month: bs.month,
        date_bs_day:   bs.day,
        date_ad:       ad,
        company:       purchase.company || undefined,
        note:          note.trim() || "Additional payment",
      };
      if (supplierName) payload.party_label = supplierName;

      await api.post("/api/transactions", payload);

      setAmount("");
      setNote("");
      setDone(`Logged ${amt.toLocaleString("en-IN")} as a new payment.`);
      await reloadPayments();
      if (onPaid) onPaid();
    } catch (e) {
      setErr(e.message || "Could not save payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h4 className="text-[13.5px] font-semibold mb-2 pt-4 border-t border-dashed border-line">
        Payments
      </h4>
      <p className="text-[11.5px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
        Payments are separate ledger entries — adding one here doesn't change this purchase's amount,
        it just reduces the supplier's outstanding balance.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-4 max-[560px]:grid-cols-1">
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Total</div>
          <div className="text-sm font-semibold tabular-nums">{rupees(total)}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Paid so far</div>
          <div className="text-sm font-semibold tabular-nums text-positive">{rupees(paidSoFar)}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Balance due</div>
          <div className="text-sm font-semibold tabular-nums text-negative">{rupees(due)}</div>
        </div>
      </div>

      {loadingPayments ? (
        <div className="text-[12px] text-ink-faint py-2">Loading payments…</div>
      ) : payments.length ? (
        <div className="border border-line rounded-sm overflow-hidden mb-4">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-[10.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-2 border-b border-line">Date (BS)</th>
                <th className="text-[10.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-2 border-b border-line">Method</th>
                <th className="text-[10.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-2 border-b border-line">Note</th>
                <th className="text-[10.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-right px-3 py-2 border-b border-line">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-1.5 border-b border-line-soft text-[12px]">
                    {p.date_bs_year}/{String(p.date_bs_month).padStart(2, "0")}/{String(p.date_bs_day).padStart(2, "0")}
                  </td>
                  <td className="px-3 py-1.5 border-b border-line-soft text-[12px]">{p.method || "—"}</td>
                  <td className="px-3 py-1.5 border-b border-line-soft text-[12px]">{p.note || "—"}</td>
                  <td className="px-3 py-1.5 border-b border-line-soft text-[12px] text-right tabular-nums">{rupees(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-[12px] text-ink-faint italic mb-4">No payments recorded yet.</div>
      )}

      {open ? (
        <div className="border border-line rounded-sm p-3 bg-surface-sunken">
          {err && (
            <div className="mb-2 text-[12px] text-negative bg-negative-tint border border-negative-tint rounded-sm px-2 py-1.5">
              {err}
            </div>
          )}
          {done && !err && (
            <div className="mb-2 text-[12px] text-positive bg-positive-tint border border-positive-tint rounded-sm px-2 py-1.5">
              {done}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mb-3 max-[560px]:grid-cols-1">
            <Field label="Amount (Rs)">
              <input
                type="number" min="0" step="0.01" className={inputCls}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                autoFocus
              />
            </Field>
            <Field label="Cash / Online">
              <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="Cash">Cash</option>
                <option value="Online">Online</option>
              </select>
            </Field>
            <Field label="Note (optional)" span={2}>
              <input
                className={inputCls} value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                placeholder="e.g. Second installment"
              />
            </Field>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" onClick={() => { setOpen(false); setErr(null); setDone(null); }} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" type="button" onClick={() => submit()} disabled={busy}>
              {busy ? "Saving…" : "Log Payment"}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setOpen(true)} size="sm" variant="primary">
          + Log Additional Payment
        </Button>
      )}
    </>
  );
}