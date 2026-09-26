import { query } from "../../config/db.js";

export async function createLinkedTransport({ kind, source }) {
  const {
    id,
    date_bs_year, date_bs_month, date_bs_day, date_ad,
    transport_fee, labor_charge, road_expense, tax_gbse,
    truck_no, truck_driver, truck_driver_phone,
    from_location, to_location,
    customer_id,
    net_qty,
    status,
  } = source;

  const fee   = Number(transport_fee) || 0;
  const labor = Number(labor_charge)  || 0;
  const road  = Number(road_expense)  || 0;
  const tax   = Number(tax_gbse)      || 0;
  const totalCost = fee + labor + road + tax;

  const hasData =
    totalCost > 0 ||
    truck_no || truck_driver || truck_driver_phone ||
    from_location || to_location;
  if (!hasData) return null;

  const saleId     = kind === "sale"     ? id : null;
  const purchaseId = kind === "purchase" ? id : null;

  const { rows } = await query(
    `INSERT INTO transportation
       (sale_id, purchase_id, customer_id,
        vehicle, driver, driver_phone, loader,
        from_location, to_location, load_kg,
        fee, labor_charge, road_expense, tax_gbse,
        date_bs_year, date_bs_month, date_bs_day, date_ad,
        status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             $11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      saleId, purchaseId, customer_id || null,
      truck_no || null,
      truck_driver || null,
      truck_driver_phone || null,
      null,
      from_location || null,
      to_location || null,
      Number(net_qty) || 0,
      fee, labor, road, tax,
      date_bs_year, date_bs_month, date_bs_day, date_ad,
      status === "Pending" ? "In Transit" : "Delivered",
    ]
  );
  return rows[0];
}
