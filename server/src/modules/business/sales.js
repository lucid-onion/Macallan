import { z } from "zod";
import { makeCrudRouter } from "./_crud.js";

const schema = z.object({
  invoice:       z.string().min(1).max(60),
  customer_id:   z.number().int().positive(),
  product:       z.string().min(1).max(120),
  date_bs_year:  z.number().int().min(2000).max(2200),
  date_bs_month: z.number().int().min(1).max(12),
  date_bs_day:   z.number().int().min(1).max(32),
  date_ad:       z.string(),
  gross_qty:     z.number().min(0),
  dust_qty:      z.number().min(0).optional(),
  net_qty:       z.number().min(0),
  rate:          z.number().min(0),
  total:         z.number().min(0),
  status:        z.enum(["Delivered", "Pending"]).optional(),
  company:       z.string().max(120).optional(),
});

export default makeCrudRouter({
  moduleName: "sales",
  table: "sales",
  entity: "sale",
  schema,
  orderBy: "date_ad DESC, id DESC",
  uniqueField: "invoice",
});