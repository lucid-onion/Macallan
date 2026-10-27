import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const EMPTY_FORM = {
  id: null,
  username: "",
  fullName: "",
  email: "",
  password: "",
  role: "USER",
  teamId: "",
};

export default function Users() {
  const { user: me, hasRole } = useAuth();
  const canCreateSuper = hasRole("SUPER_ADMIN");

  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [u, t] = await Promise.all([
        api.get("/api/users"),
        api.get("/api/teams").catch(() => ({ teams: [] })),
      ]);
      setUsers(u.users || []);
      setTeams(t.teams || []);
    } catch (e) {
      setError(e.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setShowPassword(false);
    setFormErr(null);
    setShow(true);
  }

  function openEdit(u) {
    setForm({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      email: u.email || "",
      password: "", // blank means "don't change"
      role: u.role,
      teamId: u.team_id || "",
    });
    setShowPassword(false);
    setFormErr(null);
    setShow(true);
  }

  async function submit(e) {
    e.preventDefault();
    setFormErr(null);
    setSaving(true);
    try {
      const payload = {
        fullName: form.fullName.trim(),
        email:    form.email.trim() || undefined,
        role:     form.role,
        teamId:   form.teamId ? Number(form.teamId) : null,
      };

      if (form.password) payload.password = form.password;

      if (!payload.fullName) { setFormErr("Full name is required."); setSaving(false); return; }

      if (form.id) {
        // Edit existing user
        await api.put(`/api/users/${form.id}`, payload);
      } else {
        // Create new user
        if (!form.username) { setFormErr("Username is required."); setSaving(false); return; }
        if (!form.password) { setFormErr("Password is required."); setSaving(false); return; }
        await api.post("/api/users", { ...payload, username: form.username.trim() });
      }

      setShow(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      setFormErr(e.message || "Could not save user");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(u) {
    if (!confirm(`Deactivate ${u.full_name}? Their data is preserved but login is revoked.`)) return;
    try {
      await api.post(`/api/users/${u.id}/deactivate`);
      await load();
    } catch (e) {
      alert(e.message || "Could not deactivate user");
    }
  }

  async function reactivate(u) {
    try {
      await api.post(`/api/users/${u.id}/reactivate`);
      await load();
    } catch (e) {
      alert(e.message || "Could not reactivate user");
    }
  }

  async function deleteUser(u) {
    if (!confirm(`DELETE ${u.username} permanently? This cannot be undone and will break any records linked to them.`)) return;
    try {
      await api.del(`/api/users/${u.id}`);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete user");
    }
  }

  const roleOptions = canCreateSuper
    ? ["USER", "ACCOUNTANT", "ADMIN", "SUPER_ADMIN"]
    : ["USER", "ACCOUNTANT"];

  return (
    <>
      <div className="flex items-end justify-between flex-wrap gap-2.5 mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight m-0">Users</h1>
          <p className="mt-1 mb-0 text-ink-soft text-[13.5px]">
            Manage accounts, roles and team membership
          </p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-[7px] rounded-sm bg-steel border border-steel text-white text-[13px] font-medium px-3.5 py-2 hover:bg-steel-dark transition-colors">
          + Add User
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="overflow-x-auto border border-line rounded-md bg-surface">
        <table className="w-full border-collapse min-w-[720px]">
          <thead>
            <tr>
              {["Username", "Full Name", "Role", "Team", "Status", "Actions"].map((h) => (
                <th key={h} className="text-left text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold px-4 py-[11px] border-b border-line whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center text-ink-faint text-sm py-6">Loading users…</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={6} className="text-center text-ink-faint text-sm py-6">No users yet.</td></tr>
            )}
            {!loading && users.map((u) => (
              <tr key={u.id} className="transition-colors hover:bg-surface-sunken">
                <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] font-medium">{u.username}</td>
                <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px]">{u.full_name}</td>
                <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px]">
                  <span className="inline-flex items-center px-[9px] py-[3px] rounded-full text-[11.5px] font-semibold bg-surface-sunken text-ink-soft">{u.role}</span>
                </td>
                <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px]">{u.team_name || "—"}</td>
                <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px]">
                  <span className={`inline-flex items-center px-[9px] py-[3px] rounded-full text-[11.5px] font-semibold ${u.is_active ? "bg-positive-tint text-positive" : "bg-negative-tint text-negative"}`}>
                    {u.is_active ? "Active" : "Deactivated"}
                  </span>
                </td>
                <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px]">
                  {u.id === me?.id ? (
                    <span className="text-ink-faint text-xs">You</span>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button onClick={() => openEdit(u)} className="text-steel text-xs hover:underline">Edit</button>
                      {u.is_active ? (
                        <button onClick={() => deactivate(u)} className="text-warning text-xs hover:underline">Deactivate</button>
                      ) : (
                        <button onClick={() => reactivate(u)} className="text-positive text-xs hover:underline">Reactivate</button>
                      )}
                      <button onClick={() => deleteUser(u)} className="text-negative text-xs hover:underline">Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create / Edit User Modal */}
      {show && (
        <div className="fixed inset-0 bg-[rgba(15,16,19,0.5)] z-[100] flex items-start justify-center overflow-y-auto px-4 py-10" onClick={(e) => { if (e.target === e.currentTarget) setShow(false); }}>
          <form onSubmit={submit} className="bg-surface rounded-md w-full max-w-[560px] shadow-[0_12px_32px_rgba(15,16,19,0.22)]">
            <div className="flex items-center justify-between px-[22px] py-[18px] border-b border-line">
              <h3 className="text-base font-semibold">{form.id ? "Edit User" : "New User"}</h3>
              <button type="button" onClick={() => setShow(false)} className="text-ink-faint text-lg w-[30px] h-[30px] rounded-sm hover:bg-surface-sunken">×</button>
            </div>

            <div className="px-[22px] py-5">
              {formErr && (
                <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">{formErr}</div>
              )}

              <div className="grid grid-cols-2 gap-3.5">
                {!form.id && (
                  <Field label="Username">
                    <input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required autoFocus placeholder="e.g. rajendra" className={inputCls} />
                  </Field>
                )}
                
                <Field label="Full Name" span={form.id ? 2 : 1}>
                  <input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} required placeholder="e.g. Rajendra Shrestha" className={inputCls} />
                </Field>
                
                <Field label="Email (optional)" span={2}>
                  <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="user@example.com" className={inputCls} />
                </Field>
                
                <Field label={form.id ? "New Password (leave blank to keep)" : "Password"} span={2}>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      required={!form.id}
                      placeholder={form.id ? "••••••••" : "Minimum 8 characters"}
                      className={inputCls + " pr-10"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                    >
                      {showPassword ? "🙈" : "👁"}
                    </button>
                  </div>
                </Field>
                
                <Field label="Role">
                  <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className={inputCls}>
                    {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
                
                <Field label="Team">
                  <select value={form.teamId} onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value }))} className={inputCls}>
                    <option value="">— none —</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-[22px] py-4 border-t border-line">
              <button type="button" onClick={() => setShow(false)} disabled={saving} className="inline-flex items-center rounded-sm bg-surface border border-line text-ink text-[13px] font-medium px-3.5 py-2 hover:bg-surface-sunken transition-colors disabled:opacity-45">Cancel</button>
              <button type="submit" disabled={saving} className="inline-flex items-center rounded-sm bg-steel border border-steel text-white text-[13px] font-medium px-3.5 py-2 hover:bg-steel-dark transition-colors disabled:opacity-45">
                {saving ? "Saving…" : form.id ? "Save Changes" : "Create User"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

const inputCls = "text-[13.5px] text-ink bg-surface-sunken border border-line rounded-sm px-[11px] py-[9px] focus:border-steel focus:bg-surface focus:outline-none w-full";

function Field({ label, children, span = 1 }) {
  return (
    <label className={`flex flex-col gap-1.5 ${span === 2 ? "col-span-2" : ""}`}>
      <span className="text-[12.5px] font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}