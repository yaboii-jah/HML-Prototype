import type { ButtonHTMLAttributes } from "react";

export function CloseButton({ iconOnly = false, className = "", "aria-label": label = "Close", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { iconOnly?: boolean }) {
  return <button {...props} type="button" aria-label={label} className={`button modal-close-button ${iconOnly ? "is-icon-only" : ""} ${className}`}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>{!iconOnly && <span>Close</span>}</button>;
}
