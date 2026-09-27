/* ==========================================================================
   printVoucher — drops one record's HTML into a dedicated #print-voucher
   element at the <body> level, toggles a body class, prints, then cleans up.
   The @media print rules in index.css hide everything else while the class
   is set. Works the same from any page (Purchase, Sale, Transport, ...).
   ========================================================================== */

const PRINT_PAGE_CSS = "@page { size: A4 portrait; margin: 10mm 8mm; }";

/** Ensures #print-voucher exists at <body>'s top level (not inside #root). */
function ensureVoucherEl() {
  let el = document.getElementById("print-voucher");
  if (!el) {
    el = document.createElement("div");
    el.id = "print-voucher";
    document.body.appendChild(el);
  }
  return el;
}

export function printVoucher(innerHtml) {
  const el = ensureVoucherEl();
  el.innerHTML = innerHtml;

  // Force a reflow so the browser sees the new content before print() is called.
  void el.offsetHeight;

  const pageStyle = document.createElement("style");
  pageStyle.id = "print-voucher-page";
  pageStyle.textContent = PRINT_PAGE_CSS;
  document.head.appendChild(pageStyle);

  document.body.classList.add("printing-voucher");

  // Small delay so Safari/Chrome pick up the class before opening the dialog.
  setTimeout(() => {
    window.print();
    // window.print() blocks until the dialog closes in every major browser,
    // so cleanup here is safe.
    document.body.classList.remove("printing-voucher");
    pageStyle.remove();
    el.innerHTML = "";
  }, 0);
}