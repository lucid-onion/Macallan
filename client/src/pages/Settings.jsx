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
    theme: "light",
  });
  const [hint, setHint] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api.get("/api/settings")
      .then((r) => {
        const c = r?.settings?.company || {};
        setCompany((prev) => ({
          ...prev,
          name: c.name ?? prev.name,
          logo: c.logo ?? prev.logo,
          openingBalance: c.openingBalance ?? prev.openingBalance,
          theme: c.theme ?? prev.theme,
        }));
        if (c.theme) document.documentElement.setAttribute("data-theme", c.theme);
      })
      .catch((e) => setLoadError(e.message || "Failed to load settings"));
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setHint("");
    try {
      await api.patch("/api/settings", { company });
      setHint("Saved.");
      setTimeout(() => setHint(""), 2000);
    } catch (e) {
      setHint(e.message || "Could not save settings");
    } finally {
      setSaving(false);
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
        <form onSubmit={save} className="bg-surface border border-line rounded-md shadow-card px-5 py-[18px]">
          <h3 className="text-[15px] font-semibold mb-1">Company</h3>
          <p className="text-[12.5px] text-ink-faint mb-4">
            Shown in the sidebar, documents and reports.
          </p>

          <label className="flex flex-col gap-1.5 mb-3.5">
            <span className="text-[12.5px] font-medium text-ink-soft">Company Name</span>
            <input
              value={company.name}
              onChange={(e) => setCompany((c) => ({ ...c, name: e.target.value }))}
              className={inputCls}
            />
          </label>

          <label className="flex flex-col gap-1.5 mb-3.5">
            <span className="text-[12.5px] font-medium text-ink-soft">Opening Balance (Rs)</span>
            <input
              type="number"
              step="0.01"
              value={company.openingBalance}
              onChange={(e) =>
                setCompany((c) => ({ ...c, openingBalance: Number(e.target.value) || 0 }))
              }
              className={inputCls}
            />
          </label>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center rounded-sm bg-steel border border-steel text-white text-[13px] font-medium px-3.5 py-2 hover:bg-steel-dark transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {hint && <div className="text-xs text-positive mt-2.5">{hint}</div>}
        </form>

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
              }}
              className="w-5 h-5"
            />
          </label>
        </div>
      </div>
    </>
  );
}