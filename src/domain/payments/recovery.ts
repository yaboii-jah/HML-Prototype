import type { PaymentCommand } from "./payments.ts";

export type PaymentOutcome = {
  ok: boolean;
  message: string;
  uncertain?: boolean;
  conflict?: boolean;
  draftId?: string;
};

/** An uncertain write retains its exact receipt identity, including reviewed versions. */
export class PaymentRecovery {
  pending: PaymentCommand | null = null;
  private readonly send: (command: PaymentCommand) => Promise<PaymentOutcome>;
  private readonly createId: () => string;

  constructor(
    send: (command: PaymentCommand) => Promise<PaymentOutcome>,
    createId: () => string,
  ) {
    this.send = send;
    this.createId = createId;
  }

  async run(command: Omit<PaymentCommand, "requestId">): Promise<PaymentOutcome> {
    if (this.pending) {
      return { ok: false, uncertain: true, message: "Check the saved outcome before starting another action." };
    }
    this.pending = structuredClone({ ...command, requestId: this.createId() });
    return this.recover();
  }

  async recover(): Promise<PaymentOutcome> {
    if (!this.pending) return { ok: false, message: "There is no uncertain action to recover." };
    try {
      const result = await this.send(structuredClone(this.pending));
      if (result.ok || !result.uncertain) this.pending = null;
      return result;
    } catch {
      return { ok: false, uncertain: true, message: "The response was interrupted. Check the saved outcome before starting another action." };
    }
  }
}
