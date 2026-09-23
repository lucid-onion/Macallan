import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function Users() {
  const { user: me, hasRole } = useAuth();
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ username: "", fullName: "", email: "", password: "", role: "USER", teamId: "" });
  const [err, setErr] = useState(null);

  const canCreateSuper = hasRole("SUPER_ADMIN");

  async function load() {
    const [u, t] = await Promise.all([api.get("/api/users"), api.get("/api/teams")]);
    setUsers(u.users); setTeams(t.teams);
  }
  useEffect(() => { load().catch(() => {}); }, []);

  async function submit(e) {
    e.preventDefault(); setErr(null);
    try {
      await api.post("/api/users", {
        ...form,
        teamId: form.teamId ? Number(form.teamId) : null,
      });
      setShow(false);
      setForm({ username: "", fullName: "", email: "", password: "", role: "USER", teamId: "" });
      await load();
    } catch (e) { setErr(e.message); }
  }

  async function deactivate(u) {
    if (!confirm(`Deactivate ${u.full_name}? Their data is preserved but login is revoked.`)) return;
    try { await api.post(`/api/users/${u.id}/deactivate`); await load(); }
    catch (e) { alert(e.message); }
  }
  async function reactivate(u) {
    try { await api.post(`/api/users/${u.id}/reactivate`); await load(); }
    catch (e) { alert(e.message); }
  }

  // Role options available to the current actor
  const roleOptions = canCreateSuper
    ? ["USER","ACCOUNTANT","ADMIN","SUPER_ADMIN"]
    : ["USER","ACCOUNTANT"];

  return (
    <>
      <div className="flex items-end justify-between flex-wrap gap-2.5 mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight m-0">Users</h1>
          <p className="mt-1 mb-0 text-ink-soft text-[13.5px]">Manage accounts, roles and team membership</p>
        </div>
        <button
          onClick={() => setShow(true)}
          className="inline-flex items-center gap-[7px] rounded-sm bg-steel border border-steel text-white text-[13px] font-medium px-3.5 py-2 hover:bg-steel-dark hover:border-steel-dark transition-colors">
          + Add User
        </button>
      </div>

      <div className="overflow-x-auto border border-line rounded-md bg-surface">
        <table className="w-full border-collapse min-w-[720px]">
          <thead>
            <tr>
              {["Username","Full Name","Role","Team","Status","Last Login",""].map(h => (
                <th key={h} className="text-left text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold px-4 py-[11px] border-b border-line whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
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
                <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] text-ink-faint">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] text-right">
                  {u.id === me.id ? (
                    <span className="text-ink-faint text-xs">You</span>
                  ) : u.is_active ? (
                    <button onClick={() => deactivate(u)} className="text-negative text-xs hover:underline">Deactivate</button>
                  ) : (
                    <button onClick={() => reactivate(u)} className="text-positive text-xs hover:underline">Reactivate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <div className="fixed inset-0 bg-[rgba(15,16,19,0.5)] z-[100] flex items-start justify-center overflow-y-auto px-4 py-10" onClick={e => e.target === e.currentTarget && setShow(false)}>
          <form onSubmit={submit} className="bg-surface rounded-md w-full max-w-[560px] shadow-[0_12px_32px_rgba(15,16,19,0.22)]">
            <div className="flex items-center justify-between px-[22px] py-[18px] border-b border-line">
              <h3 className="text-base font-semibold">New User</h3>
              <button type="button" onClick={() => setShow(false)} className="text-ink-faint text-lg w-[30px] h-[30px] rounded-sm hover:bg-surface-sunken">×</button>
            </div>
            <div className="px-[22px] py-5">
              {err && <div className="mb-4 text-sm text-negative bg-negative-tint rounded-md px-3 py-2">{err}</div>}
              <div className="grid grid-cols-2 gap-3.5 mb-3.5">
                <Field label="Username">
                  <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required className={inputCls} />
                </Field>
                <Field label="Full Name">
                  <input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} required className={inputCls} />
                </Field>
                <Field label="Email">
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} />
                </Field>
                <Field label="Password">
                  <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required className={inputCls} />
                </Field>
                <Field label="Role">
                  <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className={inputCls}>
                    {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
                <Field label="Team">
                  <select value={form.teamId} onChange={e => setForm(f => ({ ...f, teamId: e.target.value }))} className={inputCls}>
                    <option value="">— none —</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-[22px] py-4 border-t border-line">
              <button type="button" onClick={() => setShow(false)} className="inline-flex items-center gap-[7px] rounded-sm bg-surface border border-line text-ink text-[13px] font-medium px-3.5 py-2 hover:bg-surface-sunken hover:border-ink-faint transition-colors">Cancel</button>
              <button type="submit" className="inline-flex items-center gap-[7px] rounded-sm bg-steel border border-steel text-white text-[13px] font-medium px-3.5 py-2 hover:bg-steel-dark hover:border-steel-dark transition-colors">Save User</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

const inputCls = "text-[13.5px] text-ink bg-surface-sunken border border-line rounded-sm px-[11px] py-[9px] focus:border-steel focus:bg-surface focus:outline-none w-full";
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}