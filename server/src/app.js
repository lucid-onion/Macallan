import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadUser, requireAuth } from "./middleware/auth.js";
import { requirePermission } from "./middleware/rbac.js";
import { errorHandler } from "./utils/errors.js";

import authRoutes from "./modules/auth/routes.js";
import userRoutes from "./modules/users/routes.js";
import teamRoutes from "./modules/teams/routes.js";
import catalogRoutes from "./modules/catalog/routes.js";
import settingsRoutes from "./modules/settings/routes.js";
import suppliersRoutes from "./modules/business/suppliers.js";
import customersRoutes from "./modules/business/customers.js";
import inventoryRoutes from "./modules/business/inventory.js";
import purchasesRoutes from "./modules/business/purchases.js";
import salesRoutes from "./modules/business/sales.js";
import transportRoutes from "./modules/business/transportation.js";
import transactionsRoutes from "./modules/business/transactions.js";
import officeExpRoutes from "./modules/business/office_expenses.js";
import demolitionRoutes from "./modules/business/demolition.js";
import reportsRoutes from "./modules/business/reports.js";
import companiesRoutes from "./modules/business/companies.js";
import notesRoutes from "./modules/business/notes.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN?.split(",") ?? "http://localhost:5173",
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Global rate limit — light brake; login has its own stricter limiter.
  app.use(rateLimit({ windowMs: 60_000, max: 600 }));

  app.use(loadUser);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/teams", teamRoutes);
  app.use("/api/catalog", catalogRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/companies", companiesRoutes);

  // Business modules
  app.use("/api/suppliers", suppliersRoutes);
  app.use("/api/customers", customersRoutes);
  app.use("/api/inventory", inventoryRoutes);
  app.use("/api/purchases", purchasesRoutes);
  app.use("/api/sales", salesRoutes);
  app.use("/api/transportation", transportRoutes);
  app.use("/api/transactions", transactionsRoutes);
  app.use("/api/office-expenses", officeExpRoutes);
  app.use("/api/demolition", demolitionRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/notes", notesRoutes);
  // ---- Serve the built React frontend (client/dist) ----
  // Any non-/api request falls through to the SPA entry point, so React
  // Router handles the client-side routes (/dashboard, /sales, etc.).
  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  // JSON 404 for any unmatched /api/* route (so the client's res.json()
  // never chokes on Express's default HTML page).
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `No route: ${req.method} ${req.originalUrl}` });
  });

  app.use(errorHandler);
  return app;
}