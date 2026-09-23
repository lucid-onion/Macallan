import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function Teams() {
  const [teams, setTeams] = useState([]);
  const [perms, setPerms] = useState([]);
  const [editing, setEditing] = useState(null);

  async function load() {
    const [t, p] = await Promise.all([api.get("/api/teams"), api.get("/api/catalog/permissions")]);
    setTeams(t.teams); setPerms(p.permissions);
  }
  useEffect(() => { load().catch(() => {}); }, []);

  const grouped = perms.reduce((acc, p) => {
    (acc[p.module] ||= []).push(p.action); return acc;
  }, {});

  async function save(team) {
    const payload = {
      name: team.name,
      description: team.description,
      parentTeamId: team.parent_team_id || null,
      permissions: [...(team._selected || new Set())].map(k => {
        const [module, action] = k.split(":");
        return { module, action };
      }),
    };
    if (team.id) await api.patch(`/api/teams/${team.id}`, payload);
    else await api.post("/api/teams", payload);
    setEditing(null); await load();
  }

  return (
    <>
      <div className="flex items-end justify-between flex-wrap gap-2.5 mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight m-0">Teams</h1>
          <p className="mt-1 mb-0 text-ink-soft text-[13.5px]">Users inherit the permissions granted to their team</p>
        </div>
        <button
          onClick={() => setEditing({ name: "", description: "", parent_team_id: null, _selected: new Set() })}
          className="inline-flex items-center gap-[7px] rounded-sm bg-steel border border-steel text-white text-[13px] font-medium px-3.5 py-2 hover:bg-steel-dark transition-colors">
          + New Team
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
        {teams.map(t => (
          <div key={t.id} className="bg-surface border border-line rounded-md shadow-card px-5 py-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-semibold">{t.name}</h3>
                <p className="text-xs text-ink-faint mt-0.5">{t.description || "—"}</p>
              </div>
              <button
                onClick={() => setEditing({ ...t, _selected: new Set(t.permissions.map(p => `${p.module}:${p.action}`)) })}
                className="text-xs text-steel hover:underline">Edit</button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {t.permissions.slice(0, 12).map(p => (
                <span key={`${p.module}:${p.action}`} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-steel-tint text-steel-dark">
                  {p.module}:{p.action}
                </span>
              ))}
              {t.permissions.length > 12 && <span className="text-[11px] text-ink-faint">+{t.permissions.length - 12} more</span>}
            </div>
            <div className="text-[11.5px] text-ink-faint mt-3">{t.member_count} active member{t.member_count === 1 ? "" : "s"}</div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-[rgba(15,16,19,0.5)] z-[100] flex items-start justify-center overflow-y-auto px-4 py-10" onClick={e => e.target === e.currentTarget && setEditing(null)}>
          <div className="bg-surface rounded-md w-full max-w-[760px] shadow-[0_12px_32px_rgba(15,16,19,0.22)]">
            <div className="flex items-center justify-between px-[22px] py-[18px] border-b border-line">
              <h3 className="text-base font-semibold">{editing.id ? "Edit Team" : "New Team"}</h3>
              <button onClick={() => setEditing(null)} className="text-ink-faint text-lg w-[30px] h-[30px] rounded-sm hover:bg-surface-sunken">×</button>
            </div>
            <div className="px-[22px] py-5 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3.5 mb-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-medium text-ink-soft">Name</span>
                  <input value={editing.name} onChange={e => setEditing(x => ({ ...x, name: e.target.value }))} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-medium text-ink-soft">Parent Team (inherits its permissions)</span>
                  <select value={editing.parent_team_id || ""} onChange={e => setEditing(x => ({ ...x, parent_team_id: e.target.value ? Number(e.target.value) : null }))} className={inputCls}>
                    <option value="">— none —</option>
                    {teams.filter(t => t.id !== editing.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-1.5 mb-4">
                <span className="text-[12.5px] font-medium text-ink-soft">Description</span>
                <input value={editing.description || ""} onChange={e => setEditing(x => ({ ...x, description: e.target.value }))} className={inputCls} />
              </label>

              <h4 className="text-sm font-semibold mb-2">Permissions (inherited by members)</h4>
              <div className="flex flex-col gap-3">
                {Object.entries(grouped).map(([module, actions]) => (
                  <div key={module}>
                    <div className="text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold mb-1.5">{module}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {actions.map(action => {
                        const key = `${module}:${action}`;
                        const on = editing._selected.has(key);
                        return (
                          <button key={key} type="button"
                            onClick={() => setEditing(x => {
                              const s = new Set(x._selected);
                              on ? s.delete(key) : s.add(key);
                              return { ...x, _selected: s };
                            })}
                            className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold border transition ${on ? "bg-steel-dark border-steel-dark text-white" : "bg-surface border-line text-ink-soft hover:border-ink-faint"}`}>
                            {action}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 px-[22px] py-4 border-t border-line">
              <button onClick={() => setEditing(null)} className="inline-flex items-center rounded-sm bg-surface border border-line text-ink text-[13px] font-medium px-3.5 py-2 hover:bg-surface-sunken transition-colors">Cancel</button>
              <button onClick={() => save(editing)} className="inline-flex items-center rounded-sm bg-steel border border-steel text-white text-[13px] font-medium px-3.5 py-2 hover:bg-steel-dark transition-colors">Save Team</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inputCls = "text-[13.5px] text-ink bg-surface-sunken border border-line rounded-sm px-[11px] py-[9px] focus:border-steel focus:bg-surface focus:outline-none w-full";