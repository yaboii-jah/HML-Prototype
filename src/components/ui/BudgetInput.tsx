"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { budgetInputEdit, formatBudgetInput } from "@/src/domain/budget-input";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "min" | "step"> & {
  value?: string;
  defaultValue?: string | number;
  min?: number;
  onValueChange?: (raw: string) => void;
};

export function BudgetInput({ value, defaultValue = "", min = 0, onValueChange, onKeyDown, onBlur, ...props }: Props) {
  const [local, setLocal] = useState(String(defaultValue));
  const input = useRef<HTMLInputElement>(null);
  const raw = value ?? local;
  const display = formatBudgetInput(raw);
  const validate = (element: HTMLInputElement, next: string) => element.setCustomValidity(next && Number(next) < min ? `Enter a budget of at least ${formatBudgetInput(String(min))}.` : "");
  useEffect(() => {
    input.current?.setCustomValidity(raw && Number(raw) < min ? `Enter a budget of at least ${formatBudgetInput(String(min))}.` : "");
  }, [raw, min]);
  const change = (element: HTMLInputElement, text: string, cursor: number) => {
    const edit = budgetInputEdit(text, cursor);
    if (!edit) { element.value = display; return; }
    if (value === undefined) setLocal(edit.raw);
    onValueChange?.(edit.raw);
    element.value = edit.display;
    element.setSelectionRange(edit.caret, edit.caret);
    validate(element, edit.raw);
  };
  return <input {...props} ref={input} type="text" inputMode="decimal" value={display}
    pattern="[0-9]{1,3}(,[0-9]{3})*(\.[0-9]{1,2})?"
    onChange={event => change(event.currentTarget, event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
    onKeyDown={event => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      const element = event.currentTarget, cursor = element.selectionStart;
      if (cursor === null || cursor !== element.selectionEnd) return;
      // Deleting beside a separator should remove a digit instead of restoring the comma.
      if (event.key === "Backspace" && cursor > 1 && display[cursor - 1] === ",") {
        event.preventDefault(); change(element, display.slice(0, cursor - 2) + display.slice(cursor), cursor - 2);
      } else if (event.key === "Delete" && display[cursor] === ",") {
        event.preventDefault(); change(element, display.slice(0, cursor) + display.slice(cursor + 2), cursor);
      }
    }}
    onBlur={event => {
      if (raw.endsWith(".")) change(event.currentTarget, raw.slice(0, -1), raw.length - 1);
      onBlur?.(event);
    }}/>;
}
