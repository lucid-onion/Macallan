/* ==========================================================================
   ui.jsx — shared UI primitives used by every page.
   Button, Modal, Field (label + control), and input class constants.
   ========================================================================== */
import { useEffect } from "react";

/* -------------------------------------------------------------------------
   Input / select styling. Every form in the app uses these two strings so
   every control looks identical without repeating 20 utilities per field.
   ------------------------------------------------------------------------- */
export const inputCls =
  "text-[13.5px] text-ink bg-surface-sunken border border-line rounded-sm px-[11px] py-[9px] w-full " +
  "focus:border-steel focus:bg-surface focus:outline-none";

export const selectCls = inputCls + " cursor-pointer";

/* -------------------------------------------------------------------------
   Button — one component, three variants, two sizes.
   ------------------------------------------------------------------------- */
const BASE =
  "inline-flex items-center gap-[7px] rounded-sm text-[13px] font-medium px-3.5 py-2 " +
  "transition-colors disabled:opacity-45 disabled:cursor-not-allowed";

const VARIANTS = {
  primary:
    "bg-steel border border-steel text-white hover:bg-steel-dark hover:border-steel-dark",
  secondary:
    "bg-surface border border-line text-ink hover:bg-surface-sunken hover:border-ink-faint",
  danger:
    "bg-surface border border-negative text-negative hover:bg-negative-tint",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}) {
  const sizeCls = size === "sm" ? "!px-2.5 !py-1 !text-xs" : "";
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANTS[variant]} ${sizeCls} ${className}`}
      {...rest}
    />
  );
}

/* -------------------------------------------------------------------------
   Field — label + control wrapper used by every form.
   ------------------------------------------------------------------------- */
export function Field({ label, hint, children, span = 1 }) {
  return (
    <label className={`flex flex-col gap-1.5 ${span === 2 ? "col-span-2" : ""}`}>
      <span className="text-[12.5px] font-medium text-ink-soft">
        {label}
        {hint && <span className="font-normal text-ink-faint ml-1.5">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/* -------------------------------------------------------------------------
   Modal — centered overlay with a title, body, and footer actions.
   Closes on backdrop click and Esc.
   ------------------------------------------------------------------------- */
export function Modal({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-[rgba(15,16,19,0.5)] z-[100] flex items-start justify-center overflow-y-auto px-4 py-10 max-[640px]:py-3.5 max-[640px]:px-2.5"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`bg-surface rounded-md w-full shadow-[0_12px_32px_rgba(15,16,19,0.22)] ${
          wide ? "max-w-[760px]" : "max-w-[560px]"
        } max-[640px]:max-w-full`}
      >
        <div className="flex items-center justify-between px-[22px] py-[18px] border-b border-line max-[640px]:px-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-faint text-lg w-[30px] h-[30px] rounded-sm flex items-center justify-center hover:bg-surface-sunken hover:text-ink"
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="px-[22px] py-5 max-[640px]:p-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-[22px] py-4 border-t border-line max-[640px]:px-4 max-[640px]:flex-wrap">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   ConfirmDialog — small yes/no confirm used for deletes.
   ------------------------------------------------------------------------- */
export function ConfirmDialog({ title, message, onCancel, onConfirm, confirmLabel = "Delete", busy = false }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-soft m-0">{message}</p>
    </Modal>
  );
}

/* -------------------------------------------------------------------------
   EmptyRow — standard "nothing here yet" row for tables.
   ------------------------------------------------------------------------- */
export function EmptyRow({ colSpan, children }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="text-center text-ink-faint py-7 px-4 text-[13.5px]"
      >
        {children}
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------
   Badge — colored pill for statuses.
   ------------------------------------------------------------------------- */
export function Badge({ variant = "neutral", children }) {
  const variants = {
    positive: "bg-positive-tint text-positive",
    warning:  "bg-warning-tint text-warning",
    negative: "bg-negative-tint text-negative",
    neutral:  "bg-surface-sunken text-ink-soft",
  };
  return (
    <span className={`inline-flex items-center px-[9px] py-[3px] rounded-full text-[11.5px] font-semibold ${variants[variant]}`}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
   PageHeader — the top-of-page title + description + right-side actions.
   ------------------------------------------------------------------------- */
export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-2.5 mb-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight m-0">{title}</h1>
        {description && <p className="mt-1 mb-0 text-ink-soft text-[13.5px]">{description}</p>}
      </div>
      {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------
   TableWrap — the bordered, overflow-scrolling shell around any table.
   ------------------------------------------------------------------------- */
export function TableWrap({ children }) {
  return (
    <div className="overflow-x-auto border border-line rounded-md bg-surface">
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Th / Td — column cells with the shared table styling.
   ------------------------------------------------------------------------- */
export function Th({ children, numeric = false }) {
  return (
    <th
      className={`text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold px-4 py-[11px] border-b border-line whitespace-nowrap ${
        numeric ? "text-right tabular-nums" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({ children, numeric = false, className = "" }) {
  return (
    <td
      className={`px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap ${
        numeric ? "text-right tabular-nums" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}