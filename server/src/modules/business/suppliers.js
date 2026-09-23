import { z } from "zod";
import { makeCrudRouter } from "./_crud.js";

const schema = z.object({
  name:    z.string().min(1).max(120),
  contact: z.string().max(120).optional(),
  phone:   z.string().max(40).optional(),
  type:    z.enum(["main", "small"]).optional(),
});

export default makeCrudRouter({
  moduleName: "suppliers",
  table: "suppliers",
  entity: "supplier",
  schema,
  orderBy: "name ASC",
  uniqueField: "name",
});