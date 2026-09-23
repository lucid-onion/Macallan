import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequirePermission, RequireRole } from "./ProtectedRoute";
import AppLayout from "../layouts/AppLayout";
import Login from "../pages/Login";
import Dashboard from "../pages/Dashboard";
import Inventory from "../pages/Inventory";
import Purchases from "../pages/Purchases";
import Sales from "../pages/Sales";
import Transportation from "../pages/Transportation";
import Suppliers from "../pages/Suppliers";
import Customers from "../pages/Customers";
import Transactions from "../pages/Transactions";
import OfficeExpenses from "../pages/OfficeExpenses";
import Demolition from "../pages/Demolition";
import Reports from "../pages/Reports";
import Settings from "../pages/Settings";
import Users from "../pages/Users";
import Teams from "../pages/Teams";

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Dashboard & Transactions: ACCOUNTANT, ADMIN, SUPER_ADMIN only */}
        <Route path="/dashboard" element={
          <RequireRole roles={["ACCOUNTANT","ADMIN"]}>
            <Dashboard />
          </RequireRole>
        } />
        <Route path="/transactions" element={
          <RequirePermission module="transactions">
            <Transactions />
          </RequirePermission>
        } />

        {/* Business modules: gated by permission (role + team inherited) */}
        <Route path="/inventory"      element={<RequirePermission module="inventory"><Inventory /></RequirePermission>} />
        <Route path="/purchases"      element={<RequirePermission module="purchases"><Purchases /></RequirePermission>} />
        <Route path="/sales"          element={<RequirePermission module="sales"><Sales /></RequirePermission>} />
        <Route path="/transportation" element={<RequirePermission module="transportation"><Transportation /></RequirePermission>} />
        <Route path="/suppliers"      element={<RequirePermission module="suppliers"><Suppliers /></RequirePermission>} />
        <Route path="/customers"      element={<RequirePermission module="customers"><Customers /></RequirePermission>} />
        <Route path="/office-expenses"element={<RequirePermission module="office_expenses"><OfficeExpenses /></RequirePermission>} />
        <Route path="/demolition"     element={<RequirePermission module="demolition"><Demolition /></RequirePermission>} />
        <Route path="/reports"        element={<RequirePermission module="reports"><Reports /></RequirePermission>} />

        {/* Users: ADMIN (own team, USER/ACCOUNTANT only) or SUPER_ADMIN */}
        <Route path="/users" element={<RequirePermission module="users"><Users /></RequirePermission>} />
        <Route path="/teams" element={<RequirePermission module="teams"><Teams /></RequirePermission>} />

        {/* Settings: SUPER_ADMIN only */}
        <Route path="/settings" element={<RequireRole roles={[]}><Settings /></RequireRole>} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}