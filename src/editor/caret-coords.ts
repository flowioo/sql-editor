/**
 * Compute the pixel coordinates of the textarea caret, relative to the
 * textarea's top-left. Uses a hidden mirror div with identical font,
 * padding, line-wrap, and width settings and measures a marker span at the
 * caret position (the standard "fake textarea" trick) so autocomplete popups
 * can be positioned precisely.
 */
export function computeCaretCoords(
  ta: HTMLTextAreaElement,
  pos: number,
): { top: number; left: number } {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflow = "hidden";
  // Anchor mirror to the textarea's viewport position so layout origin
  // matches exactly. visibility:hidden + pointer-events:none keep it
  // invisible and non-interactive.
  mirror.style.top = `${ta.getBoundingClientRect().top + window.scrollY}px`;
  mirror.style.left = `${ta.getBoundingClientRect().left + window.scrollX}px`;
  const widthPx = ta.clientWidth;
  // CRITICAL: copy font, padding, border, box-sizing, width, line-height
  // so layout matches the textarea exactly.
  const props = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle",
    "lineHeight", "padding", "paddingTop", "paddingLeft",
    "paddingRight", "paddingBottom",
    "border", "borderTopWidth", "borderLeftWidth",
    "boxSizing", "letterSpacing", "tabSize", "textTransform",
    "textIndent", "direction",
  ] as const;
  for (const prop of props) {
    const cssName = prop.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
    mirror.style.setProperty(cssName, cs.getPropertyValue(cssName));
  }
  mirror.style.width = `${widthPx}px`;
  // Build text up to pos + marker span (single dot ensures the span
  // is rendered with measurable width, and `markerRect.left` lands
  // exactly at the caret position).
  mirror.textContent = ta.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const taRect = ta.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  document.body.removeChild(mirror);
  // marker.left is the position of the dot's left edge = caret pos.
  // marker.top is the position of the dot's top = caret line top.
  return {
    top: markerRect.top - taRect.top,
    left: markerRect.left - taRect.left,
  };
}
