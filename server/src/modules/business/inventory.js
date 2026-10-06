import { z } from "zod";
import { makeCrudRouter } from "./_crud.js";

const schema = z.object({
  name:            z.string().min(1).max(120),
  category:        z.string().min(1).max(80),
  stock_kg:        z.number().min(0),
  reorder_level:   z.number().min(0),
  estimated_price: z.number().min(0).nullable().optional(),
  contact_person:  z.string().max(120).optional(),
  contact_phone:   z.string().max(40).optional(),
  location:        z.string().max(200).optional(),
  description:     z.string().max(500).optional(),
});

export default makeCrudRouter({
  moduleName: "inventory",
  table: "inventory_items",
  entity: "inventory",
  schema,
  orderBy: "name ASC",
  uniqueField: "name",
});