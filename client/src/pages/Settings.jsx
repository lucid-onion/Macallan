/* ==========================================================================
   Settings.jsx — System Settings (SUPER_ADMIN only).
     - Company Details   (name only)  — own Save
     - Opening Balance   (number)     — own Save
     - Company Logo      (uploader)
     - Appearance        (light/dark)
   Each card saves independently so a typo in one field can't overwrite the
   other.
   ========================================================================== */
import { useEffect, useState } from "react";
import { api } from "../api/client";

const inputCls =
  "text-[13.5px] text-ink bg-surface-sunken border border-line rounded-sm px-[11px] py-[9px] " +
  "focus:border-steel focus:bg-surface focus:outline-none w-full";

export default function Settings() {
  const [company, setCompany] = useState({
    name: "",
    logo: "",
    openingBalance: 0,
    theme:
    (typeof localStorage !== "undefined" && localStorage.getItem("asn_theme")) ||
    "light",
  });
  const [loadError, setLoadError] = useState(null);

  const [nameHint, setNameHint]     = useState("");
  const [balanceHint, setBalanceHint] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingBalance, setSavingBalance] = useState(false);

  // Keep <html data-theme> and localStorage in lockstep with the state
  // whenever the theme changes — from the toggle, or from a fresh mount.
  useEffect(() => {
    const t = company.theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("asn_theme", t); } catch { /* private mode */ }
  }, [company.theme]);

  async function saveName(e) {
    e.preventDefault();
    setSavingName(true); setNameHint("");
    try {
      await api.patch("/api/settings", { company: { name: company.name } });
      setNameHint("Company name saved.");
      setTimeout(() => setNameHint(""), 2200);
    } catch (e) {
      setNameHint(e.message || "Could not save name");
    } finally {
      setSavingName(false);
    }
  }

  async function saveBalance(e) {
    e.preventDefault();
    setSavingBalance(true); setBalanceHint("");
    try {
      await api.patch("/api/settings", {
        company: { openingBalance: Number(company.openingBalance) || 0 },
      });
      setBalanceHint("Opening balance saved.");
      setTimeout(() => setBalanceHint(""), 2200);
    } catch (e) {
      setBalanceHint(e.message || "Could not save balance");
    } finally {
      setSavingBalance(false);
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight m-0">System Settings</h1>
        <p className="mt-1 mb-0 text-ink-soft text-[13.5px]">Reserved for the Super Admin role</p>
      </div>

      {loadError && (
        <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-[18px] max-[760px]:grid-cols-1">

        {/* ---- Company Details ---- */}
        <form onSubmit={saveName} className="bg-surface border border-line rounded-md shadow-card px-5 py-[18px]">
          <h3 className="text-[15px] font-semibold mb-1">Company Details</h3>
          <p className="text-[12.5px] text-ink-faint mb-4">
            Shown in the sidebar, invoices and reports across the app.
          </p>

          <label className="flex flex-col gap-1.5 mb-3.5">
            <span className="text-[12.5px] font-medium text-ink-soft">Company Name</span>
            <input
              value={company.name}
              onChange={(e) => setCompany((c) => ({ ...c, name: e.target.value }))}
              className={inputCls}
              placeholder="e.g. ScrapLink Pvt.Ltd"
            />
          </label>

          <button
            type="submit"
            disabled={savingName}
            className="inline-flex items-center rounded-sm bg-steel border border-steel text-white text-[13px] font-medium px-3.5 py-2 hover:bg-steel-dark transition-colors disabled:opacity-50"
          >
            {savingName ? "Saving…" : "Save Name"}
          </button>
          {nameHint && <div className="text-xs text-positive mt-2.5">{nameHint}</div>}
        </form>

        {/* ---- Opening Balance ---- */}
        <form onSubmit={saveBalance} className="bg-surface border border-line rounded-md shadow-card px-5 py-[18px]">
          <h3 className="text-[15px] font-semibold mb-1">Opening Balance</h3>
          <p className="text-[12.5px] text-ink-faint mb-4">
            The cash the business started with in this app. The Company Balance on
            the Transactions page is this figure plus every transaction recorded since.
          </p>

          <label className="flex flex-col gap-1.5 mb-3.5">
            <span className="text-[12.5px] font-medium text-ink-soft">Opening Balance (Rs)</span>
            <input
              type="number"
              step="0.01"
              value={company.openingBalance}
              onChange={(e) =>
                setCompany((c) => ({ ...c, openingBalance: e.target.value }))
              }
              className={inputCls}
              placeholder="0"
            />
          </label>

          <button
            type="submit"
            disabled={savingBalance}
            className="inline-flex items-center rounded-sm bg-steel border border-steel text-white text-[13px] font-medium px-3.5 py-2 hover:bg-steel-dark transition-colors disabled:opacity-50"
          >
            {savingBalance ? "Saving…" : "Save Balance"}
          </button>
          {balanceHint && <div className="text-xs text-positive mt-2.5">{balanceHint}</div>}
        </form>

        {/* ---- Appearance ---- */}
        <div className="bg-surface border border-line rounded-md shadow-card px-5 py-[18px]">
          <h3 className="text-[15px] font-semibold mb-1">Appearance</h3>
          <p className="text-[12.5px] text-ink-faint mb-4">Light or dark interface, saved per device.</p>
          <label className="flex items-center justify-between gap-3 py-1">
            <div>
              <div className="text-[13.5px]">Dark mode</div>
              <div className="text-xs text-ink-faint mt-0.5">Off uses light theme</div>
            </div>
            <input
              type="checkbox"
              checked={company.theme === "dark"}
              onChange={(e) => {
                const theme = e.target.checked ? "dark" : "light";
                setCompany((c) => ({ ...c, theme }));
                document.documentElement.setAttribute("data-theme", theme);
                localStorage.setItem("asn_theme", theme);
              }}
              className="w-5 h-5"
            />
          </label>
        </div>

      </div>
    </>
  );
}