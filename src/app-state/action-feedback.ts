"use client";
import { useCallback } from "react";
import { useDemo } from "./DemoProvider";
import { useToasts, type ToastInput } from "./ToastProvider";
import type { Command, CommandResult } from "@/src/domain/commands";

export type ActionFeedback = {
  progress?: string;
  success?: string;
  warning?: string;
  id?: string;
};

/** Runs a domain command behind one bottom-right notification. Field-level validation stays inline beside its input. */
export function useActionFeedback() {
  const { run } = useDemo();
  const { notify, update, dismiss } = useToasts();
  const runAction = useCallback(async (command: Command, feedback: ActionFeedback = {}): Promise<CommandResult> => {
    if (!feedback.progress) return run(command);
    const id = notify({ id: feedback.id, tone: "progress", title: feedback.progress });
    const result = await run(command);
    if (!result.ok) {
      if (result.field) dismiss(id);
      else update(id, { tone: "error", title: result.message });
      return result;
    }
    if (feedback.warning) update(id, { tone: "warning", title: feedback.warning, detail: result.message });
    else if (feedback.success) update(id, { tone: "success", title: feedback.success || result.message });
    else dismiss(id);
    return result;
  }, [run, notify, update, dismiss]);
  const notifyAction = useCallback((input: ToastInput) => notify(input), [notify]);
  return { runAction, notify: notifyAction, update, dismiss };
}