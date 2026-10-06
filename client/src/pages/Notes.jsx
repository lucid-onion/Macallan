/* ==========================================================================
   Notes.jsx — shared team reminders.
   Anyone can view. Only ADMIN / SUPER_ADMIN can post, toggle done, or delete.
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, ConfirmDialog, PageHeader, inputCls, selectCls } from "../components/ui";
import { bsToday, formatBs } from "../lib/nepali-date";

const todayBs = bsToday();

const EMPTY_FORM = {
  author_name: "",
  body: "",
};

export default function Notes() {
  const { has, hasRole } = useAuth();
  const canCreate = has("notes", "create");
  const canToggle = has("notes", "update");
  const canDel    = has("notes", "delete");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filter, setFilter] = useState("all"); // "all" | "pending" | "done"

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { items } = await api.get("/api/notes");
      setRows(items || []);
    } catch (e) {
      setError(e.message || "Failed to load notes");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (filter === "pending") return rows.filter((r) => !r.is_done);
    if (filter === "done")    return rows.filter((r) =>  r.is_done);
    return rows;
  }, [rows, filter]);

  const counts = useMemo(() => {
    const done = rows.filter((r) => r.is_done).length;
    return { done, pending: rows.length - done };
  }, [rows]);

  async function save(e) {
    e.preventDefault();
    setFormError(null);

    if (!form.author_name.trim()) {
      setFormError("Please enter your name.");
      return;
    }
    if (!form.body.trim()) {
      setFormError("Please write something in the note.");
      return;
    }

    setSaving(true);
    try {
      const today = bsToday();
      await api.post("/api/notes", {
        author_name: form.author_name.trim(),
        body: form.body.trim(),
        date_bs_year:  today.year,
        date_bs_month: today.month,
        date_bs_day:   today.day,
        date_ad:       new Date().toISOString().slice(0, 10),
      });
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save note");
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone(row) {
    try {
      // Optimistic update — flip locally, then reconcile from the response.
      setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, is_done: !r.is_done } : r));
      const { item } = await api.patch(`/api/notes/${row.id}/toggle`);
      setRows((rs) => rs.map((r) => r.id === item.id ? item : r));
    } catch (e) {
      // Revert on failure
      setRows((rs) => rs.map((r) => r.id === row.id ? row : r));
      alert(e.message || "Could not update note");
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/notes/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete note");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Notes"
        description="Reminders for the whole team — write it here, tick it when it's done"
      />

      {/* ---------- Add note form (admins only) ---------- */}
      {canCreate && (
        <form
          onSubmit={save}
          className="bg-surface border border-line rounded-md p-4 mb-5"
        >
          <div className="grid grid-cols-[240px_1fr] gap-3.5 mb-3 max-[760px]:grid-cols-1">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink-soft">Your Name</span>
              <input
                className={inputCls}
                value={form.author_name}
                onChange={(e) => setForm((f) => ({ ...f, author_name: e.target.value }))}
                placeholder="Who is writing this note?"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink-soft">Note</span>
              <textarea
                className={inputCls + " !min-h-[86px] resize-y"}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="e.g. Call the supplier about Friday's delivery"
              />
            </label>
          </div>

          {formError && (
            <div className="mb-3 text-sm text-negative">
              {formError}
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add Note"}
            </Button>
          </div>
        </form>
      )}

      {/* ---------- Filter bar ---------- */}
      <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded-md p-2.5 mb-4">
        <label className="text-xs text-ink-faint pl-1">Show</label>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={selectCls + " !w-auto"}
        >
          <option value="all">All notes</option>
          <option value="pending">Pending</option>
          <option value="done">Done</option>
        </select>
        <span className="ml-auto text-[12.5px] text-ink-soft pr-1">
          <strong className="text-ink font-semibold">{counts.pending}</strong> pending
          {" · "}
          <strong className="text-ink font-semibold">{counts.done}</strong> done
        </span>
      </div>

      {error && (
        <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* ---------- List ---------- */}
      {loading ? (
        <div className="text-ink-faint text-sm py-8 text-center">Loading notes…</div>
      ) : filtered.length === 0 ? (
        <div className="text-ink-faint text-sm py-8 text-center bg-surface border border-line rounded-md">
          {rows.length === 0
            ? (canCreate
                ? "No notes yet — write the first reminder above."
                : "No notes yet.")
            : "No notes match the current filter."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              canToggle={canToggle}
              canDel={canDel}
              onToggle={() => toggleDone(n)}
              onDelete={() => setToDelete(n)}
            />
          ))}
        </div>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete note?"
          message="Delete this note? This can't be undone."
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
function NoteRow({ note, canToggle, canDel, onToggle, onDelete }) {
  const isDone = note.is_done;
  return (
    <div
      className={
        "flex items-start gap-3 border rounded-md px-4 py-3 transition-colors " +
        (isDone
          ? "bg-positive-tint/40 border-positive-tint"
          : "bg-surface border-line hover:border-steel")
      }
    >
      {/* Checkbox — only admins can toggle; others just see the state */}
      <input
        type="checkbox"
        checked={isDone}
        onChange={canToggle ? onToggle : undefined}
        disabled={!canToggle}
        className={
          "mt-1 w-[16px] h-[16px] " +
          (canToggle ? "cursor-pointer" : "cursor-not-allowed opacity-60")
        }
        aria-label={isDone ? "Mark as pending" : "Mark as done"}
      />

      <div className="flex-1 min-w-0">
        <div
          className={
            "text-[13.5px] leading-snug whitespace-pre-wrap break-words " +
            (isDone ? "line-through text-ink-faint" : "text-ink")
          }
        >
          {note.body}
        </div>
        <div className="mt-1 text-[11.5px] text-ink-faint">
          {note.author_name}
          {" · "}
          <span className="np">{formatBs(note)}</span>
          {isDone && note.done_at ? <> · done {new Date(note.done_at).toLocaleDateString()}</> : null}
        </div>
      </div>

      {canDel && (
        <button
          type="button"
          onClick={onDelete}
          className="text-negative text-xs hover:underline shrink-0 mt-1"
        >
          Delete
        </button>
      )}
    </div>
  );
}