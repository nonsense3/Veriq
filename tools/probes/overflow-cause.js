(() => {
  // Lists elements that are wider than the space their parent offers. The shallowest such element
  // is the one dictating the page width; everything above it is just being stretched.
  const describe = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    return el.tagName.toLowerCase() + id + cls;
  };
  const depth = (el) => {
    let d = 0;
    for (let p = el.parentElement; p; p = p.parentElement) d++;
    return d;
  };
  const rows = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed" || cs.position === "absolute") continue;
    if (el.classList.contains("sr-only")) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const avail = parent.clientWidth;
    const w = el.getBoundingClientRect().width;
    if (avail > 0 && w > avail + 1) {
      rows.push({
        sel: describe(el),
        parent: describe(parent),
        w: Math.round(w),
        avail,
        over: Math.round(w - avail),
        d: depth(el),
        text: (el.textContent || "").trim().slice(0, 36),
      });
    }
  }
  rows.sort((a, b) => a.d - b.d || b.over - a.over);
  return (
    `device ${window.innerWidth}, scrollWidth ${document.documentElement.scrollWidth}\n` +
    rows.slice(0, 14).map((r) => `d${r.d} ${r.sel} is ${r.w}px in ${r.avail}px of ${r.parent} (+${r.over}) "${r.text}"`).join("\n")
  );
})();
