/* ==========================================================================
   reports.js — all 14 reports + the dashboard summary.
   Each report returns { title, summary, headers, rows }.
     - summary: [{ label, value }] rendered as the stat row + the top of
                the Excel export
     - headers: string[] table column labels
     - rows:    string[][] — already formatted display strings, so what you
                see on screen is exactly what gets exported and printed
   ========================================================================== */
import { Router } from "express";
import { query } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";

const router = Router();
router.use(requireAuth);

/* -------------------------------------------------------------------------
   Formatting helpers (server-side, mirror the client's formatCurrency)
   ------------------------------------------------------------------------- */
function rupees(n) {
  const x = Number(n) || 0;
  // Indian grouping: 12,34,567
  const [whole, frac] = Math.round(x * 100) / 100 === x
    ? [String(Math.round(x)), ""]
    : [String(Math.floor(x)), (x - Math.floor(x)).toFixed(2).slice(2)];
  const g = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                 .replace(/(\d+),(\d{3})(,|$)/, "$1,$2$3")
                 .replace(/^(\d+?)(\d{3})(\d{2})?$/, (_, a, b, c) => c ? `${a},${b},${c}` : `${a},${b}`);
  // Simpler and correct: do it the classic Indian way.
  const s = String(Math.round(x));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `Rs. ${(x < 0 ? "-" : "")}${grouped}`;
}
function kg(n) {
  return `${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
}
function bsDate(r) {
  if (!r) return "—";
  const y = r.date_bs_year, m = String(r.date_bs_month).padStart(2, "0"), d = String(r.date_bs_day).padStart(2, "0");
  return `${y}/${m}/${d}`;
}
function adDate(r) {
  return r?.date_ad ? String(r.date_ad).slice(0, 10) : "—";
}
function num(v) { const x = Number(v); return isFinite(x) ? x : 0; }

/* -------------------------------------------------------------------------
   Common query — all business tables share the same date columns, so we
   can filter them the same way. Pass a "where" fragment for extra filters.
   ------------------------------------------------------------------------- */
async function fetchAll(table, filters = {}) {
  const params = [];
  const where = ["deleted_at IS NULL"];
  if (filters.year)       { params.push(filters.year);       where.push(`date_bs_year = $${params.length}`); }
  if (filters.month)      { params.push(filters.month);      where.push(`date_bs_month = $${params.length}`); }
  if (filters.day)        { params.push(filters.day);        where.push(`date_bs_day = $${params.length}`); }
  if (filters.company)    { params.push(filters.company);    where.push(`company = $${params.length}`); }
  const sql = `SELECT * FROM ${table} WHERE ${where.join(" AND ")} ORDER BY date_ad DESC, id DESC`;
  const { rows } = await query(sql, params);
  return rows;
}

function parseFilters(req) {
  const f = {};
  if (req.query.year)    f.year    = Number(req.query.year);
  if (req.query.month)   f.month   = Number(req.query.month);
  if (req.query.day)     f.day     = Number(req.query.day);
  if (req.query.company) f.company = String(req.query.company);
  return f;
}

/* -------------------------------------------------------------------------
   Dashboard summary
   ------------------------------------------------------------------------- */
router.get("/dashboard-summary", requirePermission("dashboard", "view"), async (_req, res, next) => {
  try {
    const [s, p, t, l] = await Promise.all([
      query(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*)::int AS count
               FROM sales WHERE deleted_at IS NULL`),
      query(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*)::int AS count
               FROM purchases WHERE deleted_at IS NULL`),
      query(`SELECT COALESCE(SUM(fee + labor_charge + road_expense + tax_gbse),0) AS total,
                    COUNT(*)::int AS count
               FROM transportation WHERE deleted_at IS NULL`),
      query(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS balance
               FROM transactions WHERE deleted_at IS NULL`),
    ]);
    const a = s.rows[0], b = p.rows[0], c = t.rows[0], d = l.rows[0];
    res.json({
      cards: [
        { label: "Total Sales",     value: rupees(a.total),   meta: `${a.count} transactions` },
        { label: "Total Purchases", value: rupees(b.total),   meta: `${b.count} purchases` },
        { label: "Transportation",  value: rupees(c.total),   meta: `${c.count} deliveries` },
        { label: "Company Balance", value: rupees(d.balance), meta: "cash position" },
      ],
      recent: [],
    });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------
   The 14 reports. Each returns the same shape.
   ------------------------------------------------------------------------- */

router.get("/sales", requirePermission("reports", "view"), async (req, res, next) => {
  try {
    const rows = await fetchAll("sales", parseFilters(req));
    const customers = (await query(`SELECT id, name FROM customers`)).rows;
    const nameById = new Map(customers.map(c => [c.id, c.name]));

    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const qty   = rows.reduce((s, r) => s + num(r.net_qty), 0);
    const avg   = rows.length ? total / rows.length : 0;
    const delivered = rows.filter(r => r.status === "Delivered").length;

    const summary = [
      { label: "Total Sales",     value: rupees(total) },
      { label: "Steel Sold (Net)", value: kg(qty) },
      { label: "Transactions",    value: String(rows.length) },
      { label: "Average Sale",    value: rupees(avg) },
      { label: "Delivered",       value: `${delivered} / ${rows.length}` },
    ];
    const headers = ["Date (BS)", "Date (EN)", "Invoice", "Customer", "Product",
                     "Gross Qty", "Dust", "Net Qty", "Rate", "Total", "Status", "Company"];
    const out = rows.map(r => [
      bsDate(r), adDate(r), r.invoice, nameById.get(r.customer_id) || "—", r.product,
      kg(r.gross_qty), kg(r.dust_qty), kg(r.net_qty), rupees(r.rate), rupees(r.total),
      r.status, r.company || "—",
    ]);
    res.json({ title: "Monthly Sales Report", summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/purchases", requirePermission("reports", "view"), async (req, res, next) => {
  try {
    const rows = await fetchAll("purchases", parseFilters(req));
    const suppliers = (await query(`SELECT id, name FROM suppliers`)).rows;
    const nameById = new Map(suppliers.map(s => [s.id, s.name]));

    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const qty   = rows.reduce((s, r) => s + num(r.net_qty), 0);
    const avg   = rows.length ? total / rows.length : 0;
    const delivered = rows.filter(r => r.status === "Delivered").length;

    const summary = [
      { label: "Total Purchases",     value: rupees(total) },
      { label: "Steel Purchased (Net)", value: kg(qty) },
      { label: "Purchase Orders",     value: String(rows.length) },
      { label: "Average Order",       value: rupees(avg) },
      { label: "Delivered",           value: `${delivered} / ${rows.length}` },
    ];
    const headers = ["Date (BS)", "Date (EN)", "Invoice", "Supplier", "Material",
                     "Gross Qty", "Dust", "Net Qty", "Rate", "Total", "Status", "Company"];
    const out = rows.map(r => [
      bsDate(r), adDate(r), r.invoice, nameById.get(r.supplier_id) || "—", r.material,
      kg(r.gross_qty), kg(r.dust_qty), kg(r.net_qty), rupees(r.rate), rupees(r.total),
      r.status, r.company || "—",
    ]);
    res.json({ title: "Monthly Purchase Report", summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/transportation", requirePermission("reports", "view"), async (req, res, next) => {
  try {
    const rows = await fetchAll("transportation", parseFilters(req));
    const total = rows.reduce((s, r) => s + num(r.fee) + num(r.labor_charge) + num(r.road_expense) + num(r.tax_gbse), 0);
    const avg = rows.length ? total / rows.length : 0;
    const delivered = rows.filter(r => r.status === "Delivered").length;

    const summary = [
      { label: "Total Cost",        value: rupees(total) },
      { label: "Deliveries",        value: String(rows.length) },
      { label: "Avg Fee / Delivery", value: rupees(avg) },
      { label: "Delivered",         value: `${delivered} / ${rows.length}` },
    ];
    const headers = ["Date (BS)", "Date (EN)", "Vehicle", "Driver", "Loader",
                     "Route", "Load", "Cost", "Status"];
    const out = rows.map(r => [
      bsDate(r), adDate(r), r.vehicle || "—", r.driver || "—", r.loader || "—",
      `${r.from_location || "—"} → ${r.to_location || "—"}`,
      kg(r.load_kg),
      rupees(num(r.fee) + num(r.labor_charge) + num(r.road_expense) + num(r.tax_gbse)),
      r.status,
    ]);
    res.json({ title: "Transportation Report", summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/transactions", requirePermission("reports", "view"), async (req, res, next) => {
  try {
    const rows = await fetchAll("transactions", parseFilters(req));
    const cashIn  = rows.filter(r => r.direction === "in").reduce((s, r) => s + num(r.amount), 0);
    const cashOut = rows.filter(r => r.direction === "out").reduce((s, r) => s + num(r.amount), 0);

    const summary = [
      { label: "Money In",    value: rupees(cashIn) },
      { label: "Money Out",   value: rupees(cashOut) },
      { label: "Net Change",  value: rupees(cashIn - cashOut) },
      { label: "Transactions", value: String(rows.length) },
    ];
    const headers = ["Date (BS)", "Date (EN)", "Company", "Type", "Party",
                     "Direction", "Amount", "Method", "Note"];
    const out = rows.map(r => [
      bsDate(r), adDate(r), r.company || "—",
      (r.type || "").replace(/_/g, " "), r.party_label || r.party_key || "—",
      r.direction === "in" ? "Money In" : "Money Out",
      rupees(r.amount), r.method || "—", r.note || "—",
    ]);
    res.json({ title: "Monthly Transaction Report", summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/office", requirePermission("reports", "view"), async (req, res, next) => {
  try {
    const rows = await fetchAll("office_expenses", parseFilters(req));
    const items = (await query(
      `SELECT i.expense_id, i.description, i.amount
         FROM office_expense_items i
         JOIN office_expenses e ON e.id = i.expense_id
        WHERE e.deleted_at IS NULL`
    )).rows;
    const itemsByExpense = new Map();
    items.forEach(it => {
      if (!itemsByExpense.has(it.expense_id)) itemsByExpense.set(it.expense_id, []);
      itemsByExpense.get(it.expense_id).push(it);
    });

    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const itemCount = items.length;

    const summary = [
      { label: "Total Expenses", value: rupees(total) },
      { label: "Slips Logged",   value: String(rows.length) },
      { label: "Line Items",     value: String(itemCount) },
      { label: "Average per Slip", value: rupees(rows.length ? total / rows.length : 0) },
    ];
    const headers = ["Date (BS)", "Date (EN)", "Company", "Description", "Amount", "Note"];
    const out = [];
    rows.forEach(e => {
      const list = itemsByExpense.get(e.id) || [];
      if (!list.length) {
        out.push([bsDate(e), adDate(e), e.company || "—", "—", "—", e.note || "—"]);
        return;
      }
      list.forEach((it, idx) => {
        out.push([
          idx === 0 ? bsDate(e) : "",
          idx === 0 ? adDate(e) : "",
          idx === 0 ? (e.company || "—") : "",
          it.description,
          rupees(it.amount),
          idx === 0 ? (e.note || "—") : "",
        ]);
      });
    });
    res.json({ title: "Monthly Office Expense Report", summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/demolition", requirePermission("reports", "view"), async (req, res, next) => {
  try {
    const rows = await fetchAll("demolitions", parseFilters(req));
    const items = (await query(
      `SELECT i.demolition_id, i.description, i.quantity, i.rate, i.amount
         FROM demolition_items i
         JOIN demolitions d ON d.id = i.demolition_id
        WHERE d.deleted_at IS NULL`
    )).rows;
    const itemsByJob = new Map();
    items.forEach(it => {
      if (!itemsByJob.has(it.demolition_id)) itemsByJob.set(it.demolition_id, []);
      itemsByJob.get(it.demolition_id).push(it);
    });

    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const transport = rows.reduce((s, r) => s + num(r.transport_fee), 0);

    const summary = [
      { label: "Total",           value: rupees(total) },
      { label: "Jobs Logged",     value: String(rows.length) },
      { label: "Transport Cost",  value: rupees(transport) },
      { label: "Average per Job", value: rupees(rows.length ? total / rows.length : 0) },
    ];
    const headers = ["Date (BS)", "Date (EN)", "Company", "Site", "Description",
                     "Quantity", "Rate", "Amount", "Transport Fee", "Job Total", "Note"];
    const out = [];
    rows.forEach(job => {
      const list = itemsByJob.get(job.id) || [];
      if (!list.length) {
        out.push([bsDate(job), adDate(job), job.company || "—", job.site || "—", "—",
                  "—", "—", "—", rupees(job.transport_fee), rupees(job.total), job.note || "—"]);
        return;
      }
      list.forEach((it, idx) => {
        out.push([
          idx === 0 ? bsDate(job) : "",
          idx === 0 ? adDate(job) : "",
          idx === 0 ? (job.company || "—") : "",
          idx === 0 ? (job.site || "—") : "",
          it.description, String(it.quantity), rupees(it.rate), rupees(it.amount),
          idx === 0 ? rupees(job.transport_fee) : "",
          idx === 0 ? rupees(job.total) : "",
          idx === 0 ? (job.note || "—") : "",
        ]);
      });
    });
    res.json({ title: "Monthly Demolition Report", summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/customer-statement", requirePermission("reports", "view"), async (req, res, next) => {
  try {
    const customerId = Number(req.query.customerId);
    if (!customerId) return res.status(400).json({ error: "customerId is required" });
    const customerRow = await query(`SELECT id, name FROM customers WHERE id = $1`, [customerId]);
    if (!customerRow.rowCount) return res.status(404).json({ error: "Customer not found" });
    const customer = customerRow.rows[0];

    const filters = parseFilters(req);
    const params = [customerId];
    const where = ["s.customer_id = $1", "s.deleted_at IS NULL"];
    if (filters.year)  { params.push(filters.year);  where.push(`s.date_bs_year = $${params.length}`); }
    if (filters.month) { params.push(filters.month); where.push(`s.date_bs_month = $${params.length}`); }
    if (filters.day)   { params.push(filters.day);   where.push(`s.date_bs_day = $${params.length}`); }
    if (filters.company) { params.push(filters.company); where.push(`s.company = $${params.length}`); }
    const { rows } = await query(
      `SELECT s.* FROM sales s WHERE ${where.join(" AND ")} ORDER BY s.date_ad DESC, s.id DESC`,
      params
    );

    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const qty = rows.reduce((s, r) => s + num(r.net_qty), 0);

    const summary = [
      { label: "Total Sales", value: rupees(total) },
      { label: "Steel Sold (Net)", value: kg(qty) },
      { label: "Transactions", value: String(rows.length) },
    ];
    const headers = ["Date (BS)", "Date (EN)", "Invoice", "Product", "Net Qty", "Rate", "Total", "Status", "Company"];
    const out = rows.map(r => [
      bsDate(r), adDate(r), r.invoice, r.product, kg(r.net_qty), rupees(r.rate), rupees(r.total),
      r.status, r.company || "—",
    ]);
    res.json({ title: `Buyer Statement — ${customer.name}`, summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/supplier-statement", requirePermission("reports", "view"), async (req, res, next) => {
  try {
    const supplierId = Number(req.query.supplierId);
    if (!supplierId) return res.status(400).json({ error: "supplierId is required" });
    const supplierRow = await query(`SELECT id, name FROM suppliers WHERE id = $1`, [supplierId]);
    if (!supplierRow.rowCount) return res.status(404).json({ error: "Supplier not found" });
    const supplier = supplierRow.rows[0];

    const filters = parseFilters(req);
    const params = [supplierId];
    const where = ["p.supplier_id = $1", "p.deleted_at IS NULL"];
    if (filters.year)  { params.push(filters.year);  where.push(`p.date_bs_year = $${params.length}`); }
    if (filters.month) { params.push(filters.month); where.push(`p.date_bs_month = $${params.length}`); }
    if (filters.day)   { params.push(filters.day);   where.push(`p.date_bs_day = $${params.length}`); }
    if (filters.company) { params.push(filters.company); where.push(`p.company = $${params.length}`); }
    const { rows } = await query(
      `SELECT p.* FROM purchases p WHERE ${where.join(" AND ")} ORDER BY p.date_ad DESC, p.id DESC`,
      params
    );

    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const qty = rows.reduce((s, r) => s + num(r.net_qty), 0);

    const summary = [
      { label: "Total Purchases", value: rupees(total) },
      { label: "Steel Bought (Net)", value: kg(qty) },
      { label: "Purchase Orders", value: String(rows.length) },
    ];
    const headers = ["Date (BS)", "Date (EN)", "Invoice", "Material", "Net Qty", "Rate", "Total", "Status", "Company"];
    const out = rows.map(r => [
      bsDate(r), adDate(r), r.invoice, r.material, kg(r.net_qty), rupees(r.rate), rupees(r.total),
      r.status, r.company || "—",
    ]);
    res.json({ title: `Supplier Statement — ${supplier.name}`, summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/all-customers", requirePermission("reports", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.name,
              COALESCE(SUM(s.total),0) AS sales,
              COALESCE(SUM(s.net_qty),0) AS qty,
              COUNT(s.id)::int AS count
         FROM customers c
         LEFT JOIN sales s ON s.customer_id = c.id AND s.deleted_at IS NULL
        GROUP BY c.id, c.name
        ORDER BY sales DESC`
    );
    const total = rows.reduce((s, r) => s + num(r.sales), 0);

    const summary = [
      { label: "Customer Groups", value: String(rows.length) },
      { label: "Combined Sales",  value: rupees(total) },
    ];
    const headers = ["Customer", "Sales", "Steel Sold (Net)", "Transactions", "Share of Sales"];
    const out = rows.map(r => [
      r.name, rupees(r.sales), kg(r.qty), String(r.count),
      `${total ? ((num(r.sales) / total) * 100).toFixed(1) : "0.0"}%`,
    ]);
    res.json({ title: "All Buyers Report", summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/all-suppliers", requirePermission("reports", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.name,
              COALESCE(SUM(p.total),0) AS purchases,
              COALESCE(SUM(p.net_qty),0) AS qty,
              COUNT(p.id)::int AS count
         FROM suppliers s
         LEFT JOIN purchases p ON p.supplier_id = s.id AND p.deleted_at IS NULL
        GROUP BY s.id, s.name
        ORDER BY purchases DESC`
    );
    const total = rows.reduce((s, r) => s + num(r.purchases), 0);

    const summary = [
      { label: "Supplier Groups",   value: String(rows.length) },
      { label: "Combined Purchases", value: rupees(total) },
    ];
    const headers = ["Supplier", "Purchases", "Steel Bought (Net)", "Purchase Orders", "Share of Purchases"];
    const out = rows.map(r => [
      r.name, rupees(r.purchases), kg(r.qty), String(r.count),
      `${total ? ((num(r.purchases) / total) * 100).toFixed(1) : "0.0"}%`,
    ]);
    res.json({ title: "All Sellers Report", summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/inventory", requirePermission("reports", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM inventory_items WHERE deleted_at IS NULL ORDER BY name`
    );
    const totalStock = rows.reduce((s, r) => s + num(r.stock_kg), 0);
    const low = rows.filter(r => num(r.stock_kg) < num(r.reorder_level)).length;

    const summary = [
      { label: "Total Products", value: String(rows.length) },
      { label: "Total Stock",    value: kg(totalStock) },
      { label: "Low Stock Items", value: String(low) },
    ];
    const headers = ["Product", "Category", "Current Stock", "Reorder Level", "Status"];
    const out = rows.map(r => {
      const low = num(r.stock_kg) < num(r.reorder_level);
      return [r.name, r.category || "—", kg(r.stock_kg), kg(r.reorder_level), low ? "Low Stock" : "OK"];
    });
    res.json({ title: "Stock Report", summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/ledger", requirePermission("reports", "view"), async (_req, res, next) => {
  try {
    // Receivable/payable per party.
    const { rows: cust } = await query(
      `SELECT c.name,
              COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.customer_id = c.id AND s.deleted_at IS NULL),0) AS billed,
              COALESCE((SELECT SUM(CASE WHEN t.direction='in' THEN t.amount ELSE -t.amount END)
                          FROM transactions t
                         WHERE t.party_type='customer' AND t.party_key = c.id::text AND t.deleted_at IS NULL),0) AS paid
         FROM customers c`
    );
    const { rows: sup } = await query(
      `SELECT s.name,
              COALESCE((SELECT SUM(p.total) FROM purchases p WHERE p.supplier_id = s.id AND p.deleted_at IS NULL),0) AS billed,
              COALESCE((SELECT SUM(CASE WHEN t.direction='out' THEN t.amount ELSE -t.amount END)
                          FROM transactions t
                         WHERE t.party_type='supplier' AND t.party_key = s.name AND t.deleted_at IS NULL),0) AS paid
         FROM suppliers s`
    );

    const customers = cust.map(r => ({
      party: r.name, type: "Customer", billed: num(r.billed), paid: num(r.paid), due: num(r.billed) - num(r.paid),
    }));
    const suppliers = sup.map(r => ({
      party: r.name, type: "Supplier", billed: num(r.billed), paid: num(r.paid), due: num(r.billed) - num(r.paid),
    }));
    const all = [...customers, ...suppliers].sort((a, b) => Math.abs(b.due) - Math.abs(a.due));

    const totalReceivable = customers.filter(r => r.due > 0).reduce((s, r) => s + r.due, 0);
    const totalPayable    = suppliers.filter(r => r.due > 0).reduce((s, r) => s + r.due, 0);

    const summary = [
      { label: "Total Receivable", value: rupees(totalReceivable) },
      { label: "Total Payable",    value: rupees(totalPayable) },
      { label: "Parties",          value: String(all.length) },
    ];
    const headers = ["Party", "Type", "Billed", "Paid", "Balance"];
    const out = all.map(r => [
      r.party, r.type, rupees(r.billed), rupees(r.paid),
      r.due > 0 ? `${rupees(r.due)} due` : r.due < 0 ? `${rupees(-r.due)} overpaid` : "Settled",
    ]);
    res.json({ title: "Outstanding Balances Report", summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/company-summary", requirePermission("reports", "view"), async (_req, res, next) => {
  try {
    // Company totals across the modules that carry a company field.
    const { rows } = await query(`
      WITH companies AS (
        SELECT DISTINCT company FROM sales        WHERE deleted_at IS NULL AND company IS NOT NULL
        UNION SELECT DISTINCT company FROM purchases WHERE deleted_at IS NULL AND company IS NOT NULL
        UNION SELECT DISTINCT company FROM office_expenses WHERE deleted_at IS NULL AND company IS NOT NULL
        UNION SELECT DISTINCT company FROM demolitions WHERE deleted_at IS NULL AND company IS NOT NULL
      )
      SELECT c.company,
        COALESCE((SELECT SUM(total) FROM sales            WHERE company = c.company AND deleted_at IS NULL),0) AS sales,
        COALESCE((SELECT SUM(total) FROM purchases        WHERE company = c.company AND deleted_at IS NULL),0) AS purchases,
        COALESCE((SELECT SUM(fee+labor_charge+road_expense+tax_gbse) FROM transportation t
                    JOIN purchases p ON p.id = t.purchase_id
                   WHERE p.company = c.company AND t.deleted_at IS NULL),0) AS transport,
        COALESCE((SELECT SUM(total) FROM office_expenses  WHERE company = c.company AND deleted_at IS NULL),0) AS office,
        COALESCE((SELECT SUM(total) FROM demolitions      WHERE company = c.company AND deleted_at IS NULL),0) AS demolition
      FROM companies c
      ORDER BY c.company
    `);

    const combinedSales  = rows.reduce((s, r) => s + num(r.sales), 0);
    const combinedProfit = rows.reduce((s, r) =>
      s + num(r.sales) - num(r.purchases) - num(r.transport) - num(r.office) - num(r.demolition), 0);

    const summary = [
      { label: "Companies",           value: String(rows.length) },
      { label: "Combined Sales",      value: rupees(combinedSales) },
      { label: "Combined Net Profit", value: rupees(combinedProfit) },
    ];
    const headers = ["Company", "Sales", "Purchases", "Transport", "Office", "Demolition", "Net Profit"];
    const out = rows.map(r => {
      const profit = num(r.sales) - num(r.purchases) - num(r.transport) - num(r.office) - num(r.demolition);
      return [r.company, rupees(r.sales), rupees(r.purchases), rupees(r.transport), rupees(r.office), rupees(r.demolition), rupees(profit)];
    });
    res.json({ title: "Company-wise Summary Report", summary, headers, rows: out });
  } catch (e) { next(e); }
});

router.get("/profit", requirePermission("reports", "view"), async (req, res, next) => {
  try {
    const f = parseFilters(req);
    async function sumFor(table, expr = "total") {
      const params = [];
      const where = ["deleted_at IS NULL"];
      if (f.year)  { params.push(f.year);  where.push(`date_bs_year = $${params.length}`); }
      if (f.month) { params.push(f.month); where.push(`date_bs_month = $${params.length}`); }
      if (f.day)   { params.push(f.day);   where.push(`date_bs_day = $${params.length}`); }
      if (f.company) { params.push(f.company); where.push(`company = $${params.length}`); }
      const { rows } = await query(`SELECT COALESCE(SUM(${expr}),0) AS v FROM ${table} WHERE ${where.join(" AND ")}`, params);
      return num(rows[0].v);
    }

    const sales      = await sumFor("sales");
    const purchases  = await sumFor("purchases");
    const office     = await sumFor("office_expenses");
    const demolition = await sumFor("demolitions");
    const transport  = await sumFor("transportation", "fee + labor_charge + road_expense + tax_gbse");

    const totalCosts = purchases + transport + office + demolition;
    const profit = sales - totalCosts;
    const margin = sales ? (profit / sales) * 100 : 0;

    const summary = [
      { label: "Total Sales", value: rupees(sales) },
      { label: "Total Costs", value: rupees(totalCosts) },
      { label: "Net Profit",  value: rupees(profit) },
      { label: "Margin",      value: `${margin.toFixed(1)}%` },
    ];
    const headers = ["Item", "Amount"];
    const out = [
      ["Total Sales",          rupees(sales)],
      ["Total Purchases",      rupees(purchases)],
      ["Transportation Cost",  rupees(transport)],
      ["Office Expenses",      rupees(office)],
      ["Demolition Cost",      rupees(demolition)],
      ["Total Costs",          rupees(totalCosts)],
      ["Net Profit",           rupees(profit)],
      ["Profit Margin",        `${margin.toFixed(1)}%`],
    ];
    res.json({ title: "Profit & Loss Summary", summary, headers, rows: out });
  } catch (e) { next(e); }
});

export default router;