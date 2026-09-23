import { z } from "zod";
import { makeCrudRouter } from "./_crud.js";

const schema = z.object({
  name:         z.string().min(1).max(120),
  category:     z.string().min(1).max(80),
  stock_kg:     z.number().min(0),
  reorder_level:z.number().min(0),
});

export default makeCrudRouter({
  moduleName: "inventory",
  table: "inventory_items",
  entity: "inventory",
  schema,
  orderBy: "name ASC",
  uniqueField: "name",
});