import { z } from "zod";
import { makeCrudRouter } from "./_crud.js";

const schema = z.object({
  sale_id:       z.number().int().positive().nullable().optional(),
  purchase_id:   z.number().int().positive().nullable().optional(),
  customer_id:   z.number().int().positive().nullable().optional(),
  vehicle:       z.string().max(60).optional(),
  driver:        z.string().max(120).optional(),
  driver_phone:  z.string().max(40).optional(),
  loader:        z.string().max(120).optional(),
  from_location: z.string().max(200).optional(),
  to_location:   z.string().max(200).optional(),
  load_kg:       z.number().min(0).optional(),
  fee:           z.number().min(0).optional(),
  labor_charge:  z.number().min(0).optional(),
  road_expense:  z.number().min(0).optional(),
  tax_gbse:      z.number().min(0).optional(),
  date_bs_year:  z.number().int().min(2000).max(2200),
  date_bs_month: z.number().int().min(1).max(12),
  date_bs_day:   z.number().int().min(1).max(32),
  date_ad:       z.string(),
  status:        z.enum(["Delivered", "In Transit"]).optional(),
});

export default makeCrudRouter({
  moduleName: "transportation",
  table: "transportation",
  entity: "transport",
  schema,
  orderBy: "date_ad DESC, id DESC",
});