import { z } from "zod";
import { makeCrudRouter } from "./_crud.js";

const dateFields = {
  date_bs_year:  z.number().int().min(2000).max(2200),
  date_bs_month: z.number().int().min(1).max(12),
  date_bs_day:   z.number().int().min(1).max(32),
  date_ad:       z.string(), // ISO yyyy-mm-dd
};

const schema = z.object({
  invoice:        z.string().min(1).max(60),
  supplier_id:    z.number().int().positive(),
  material:       z.string().min(1).max(120),
  ...dateFields,
  gross_qty:      z.number().min(0),
  dust_qty:       z.number().min(0).optional(),
  net_qty:        z.number().min(0),
  rate:           z.number().min(0),
  total:          z.number().min(0),
  transport_fee:  z.number().min(0).optional(),
  labor_charge:   z.number().min(0).optional(),
  road_expense:   z.number().min(0).optional(),
  tax_gbse:       z.number().min(0).optional(),
  truck_no:       z.string().max(60).optional(),
  truck_driver:   z.string().max(120).optional(),
  truck_driver_phone: z.string().max(40).optional(),
  from_location:  z.string().max(200).optional(),
  to_location:    z.string().max(200).optional(),
  status:         z.enum(["Delivered", "Pending"]).optional(),
  company:        z.string().max(120).optional(),
});

export default makeCrudRouter({
  moduleName: "purchases",
  table: "purchases",
  entity: "purchase",
  schema,
  orderBy: "date_ad DESC, id DESC",
  uniqueField: "invoice",
});