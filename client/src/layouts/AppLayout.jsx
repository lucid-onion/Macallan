import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  inventory: <><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></>,
  purchases: <><path d="M6 2l1.5 4M18 2l-1.5 4"/><rect x="4" y="6" width="16" height="15" rx="2"/><path d="M9 10a3 3 0 0 0 6 0"/></>,
  sales: <><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></>,
  transportation: <><rect x="1" y="7" width="14" height="10" rx="1.5"/><path d="M15 10h4l3 3v4h-7z"/><circle cx="6" cy="19" r="1.7"/><circle cx="17.5" cy="19" r="1.7"/></>,
  suppliers: <><path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v9h14v-9"/><path d="M9 19v-5h6v5"/></>,
  customers: <><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="18" cy="9" r="2.6"/><path d="M15.5 14.2c2.7.3 4.9 2.3 5 5.8"/></>,
  transactions: <><path d="M7 3v18M7 21l-4-4M7 21l4-4"/><path d="M17 21V3M17 3l4 4M17 3l-4 4"/></>,
  officeExpenses: <><path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/></>,
  demolition: <><path d="M3 21h18"/><path d="M5 21V10l6-5 6 5v11"/><path d="M9 21v-6h6v6"/><path d="M3 10l2-2M21 10l-2-2"/></>,
  reports: <><path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4"/><path d="M9 13h6M9 17h6M9 9h2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V19a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
};

function NavItem({ to, module, label, iconKey }) {
  const { has, hasRole } = useAuth();
  if (module && !hasRole("SUPER_ADMIN") && !has(module, "view")) return null;
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-[11px] px-2.5 py-[9px] rounded-sm text-[13.5px] text-sidebar-text mb-0.5 transition-colors hover:bg-sidebar-raised hover:text-white ${isActive ? "!bg-steel-dark !text-white" : ""}`
      }
    >
      <svg className="shrink-0 opacity-85" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{ICONS[iconKey]}</svg>
      {label}
    </NavLink>
  );
}

export default function AppLayout() {
  const { user, has, hasRole, logout } = useAuth();
  const isSuperOrAdmin = hasRole("ADMIN");

  return (
    <div className="flex min-h-screen">
      <aside className="w-[232px] shrink-0 bg-sidebar text-sidebar-text flex flex-col sticky top-0 h-screen">
        <div className="flex items-center gap-2.5 px-5 py-[22px] border-b border-white/[0.06]">
          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shrink-0 overflow-hidden p-[3px]">
            <img src="/logo.png" alt="" className="max-w-full max-h-full object-contain block" />
          </div>
          <div>
            <div className="text-white font-semibold text-[14.5px] leading-tight">ASN Demolition</div>
            <div className="text-sidebar-text text-[11.5px]">Inventory &amp; Sales</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-3.5 overflow-y-auto">
          <NavItem to="/dashboard" module="dashboard" label="Dashboard" iconKey="dashboard" />
          <NavItem to="/inventory" module="inventory" label="Inventory" iconKey="inventory" />
          <NavItem to="/purchases" module="purchases" label="Purchases" iconKey="purchases" />
          <NavItem to="/sales" module="sales" label="Sales" iconKey="sales" />
          <NavItem to="/transportation" module="transportation" label="Transportation" iconKey="transportation" />
          <NavItem to="/suppliers" module="suppliers" label="Suppliers" iconKey="suppliers" />
          <NavItem to="/customers" module="customers" label="Customers" iconKey="customers" />
          <NavItem to="/transactions" module="transactions" label="Transactions" iconKey="transactions" />
          <NavItem to="/office-expenses" module="office_expenses" label="Office Expenses" iconKey="officeExpenses" />
          <NavItem to="/demolition" module="demolition" label="Demolition" iconKey="demolition" />
          <NavItem to="/reports" module="reports" label="Reports" iconKey="reports" />

          <div className="text-[11px] uppercase tracking-[0.06em] text-[#5f6470] px-2.5 pt-3.5 pb-1.5">System</div>
          {isSuperOrAdmin && (
            <>
              <NavItem to="/users" module="users" label="Users" iconKey="settings" />
              <NavItem to="/teams" module="teams" label="Teams" iconKey="settings" />
            </>
          )}
          {hasRole("SUPER_ADMIN") && (
            <NavItem to="/settings" module="settings" label="Settings" iconKey="settings" />
          )}
        </nav>

        <div className="px-5 py-2.5 border-t border-white/[0.06] text-xs text-sidebar-text">
          Signed in as <strong className="text-white">{user?.fullName || user?.username}</strong>
          <div className="text-[10.5px] text-[#8a8f9b] mt-0.5">{user?.role}</div>
          <button onClick={logout} className="mt-2 text-[11px] text-negative underline">Log out</button>
        </div>
        <div className="px-5 pt-3.5 pb-[18px] border-t border-white/[0.06] text-xs text-[#666c78]">Bikram Sambat · NPR</div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-9 pt-[30px] pb-[60px] max-w-[1280px] w-full mx-auto">
          <Outlet />
        </div>
        <footer className="px-9 pt-[18px] pb-[34px] text-ink-faint text-xs">
          ASN Demolition Pvt.Ltd — internal management system.
        </footer>
      </div>
    </div>
  );
}