"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { Item } from "@/src/domain/types";
import { dateText } from "@/src/domain/format";
import { RecordModal } from "./RecordModal";

const controls = "button, a, input, select, textarea, label, summary, [role=button], [role=link], [contenteditable=true], [data-no-row-details]";

export function MaterialDetailsRow({ onOpen, disabled = false, className = "", ...props }: HTMLAttributes<HTMLTableRowElement> & { onOpen: () => void; disabled?: boolean }) {
  return <tr {...props} className={`${className}${disabled ? "" : " material-details-row"}`} onClick={event => {
    if (disabled || event.defaultPrevented || !(event.target instanceof Element) || event.target.closest(controls)) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && (event.currentTarget.contains(selection.anchorNode) || event.currentTarget.contains(selection.focusNode))) return;
    event.currentTarget.querySelector<HTMLButtonElement>("[data-material-details-trigger], .material-name-trigger, [data-line-details]")?.focus({ preventScroll: true });
    onOpen();
  }}/>;
}

export function MaterialDetailsTrigger({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button" className={`material-name-trigger ${className}`} data-material-details-trigger aria-haspopup="dialog"/>;
}

export function MaterialDetailsSummary({ item }: { item: Item }) {
  return <div className="data-rows material-details-summary">
    <div><span>Requested quantity</span><strong>{item.quantity} {item.unit}</strong></div>
    <div><span>Date needed</span><strong>{item.neededDate ? dateText(item.neededDate) : "—"}</strong></div>
    <div><span>Purpose</span><strong>{item.purpose || "—"}</strong></div>
    <div><span>Delivery location</span><strong>{item.location || "—"}</strong></div>
    <div><span>Remarks</span><strong>{item.remarks || "—"}</strong></div>
  </div>;
}

export function MaterialDetailsModal({ item, onClose, children }: { item?: Item; onClose: () => void; children?: ReactNode }) {
  return <RecordModal open={!!item} title={item?.name || "Material details"} onClose={onClose}>
    {item && <><MaterialDetailsSummary item={item}/>{children}</>}
  </RecordModal>;
}
