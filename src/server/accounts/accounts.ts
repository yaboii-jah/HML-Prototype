import "server-only";
import {
  parseAccountCommand,
  parseDirectory,
  type AccountResult,
} from "@/src/domain/accounts/accounts";
import { readSession } from "@/src/server/auth/session";
import {
  passwordClient,
  privilegedAuthClient,
} from "@/src/server/auth/clients";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import {
  executeAccountCommand,
  type AccountActor,
  type AccountGateway,
} from "./workflow";

export async function accountActor(): Promise<AccountActor | null> {
  const session = await readSession();
  return session?.activeRole === "Administrator" &&
    session.context.roles.includes("Administrator")
    ? {
        userId: session.context.userId,
        sessionId: session.sessionId,
        revision: session.context.revision,
        activeRole: "Administrator",
      }
    : null;
}

export async function accountDirectory() {
  const actor = await accountActor();
  if (!actor) return null;
  const directory = parseDirectory(
    await serviceRpc("accounts_directory", { actor }),
  );
  if (!directory) throw Error("The user directory could not be loaded.");
  return {
    ...directory,
    actorId: actor.userId,
    emailEnabled: process.env.ACCOUNT_EMAIL_ENABLED === "true",
  };
}

function gateway(): AccountGateway {
  const client = privilegedAuthClient();
  return {
    rpc: serviceRpc,
    emailEnabled: process.env.ACCOUNT_EMAIL_ENABLED === "true",
    async identity(id) {
      const result = await client.auth.admin.getUserById(id);
      if (
        result.error?.status === 404 ||
        result.error?.code === "user_not_found"
      )
        return null;
      if (result.error || !result.data.user)
        throw Error("Identity lookup unavailable");
      return {
        id: result.data.user.id,
        email: result.data.user.email,
        marker: result.data.user.app_metadata.account_request_id,
      };
    },
    async create(id, email, requestId) {
      const result = await client.auth.admin.createUser({
        id,
        email,
        email_confirm: false,
        app_metadata: { account_request_id: requestId },
      });
      if (result.error) throw Error("Identity provisioning unavailable");
    },
    async send(kind, email) {
      const origin = process.env.APP_ORIGIN;
      if (!origin || !/^https?:\/\//.test(origin)) return "failed";
      const redirectTo = new URL("/auth/confirm", origin).href;
      const result =
        kind === "invite"
          ? await client.auth.admin.inviteUserByEmail(email, { redirectTo })
          : await passwordClient().auth.resetPasswordForEmail(email, {
              redirectTo,
            });
      // Provider/network failures cannot prove that no message was accepted.
      return result.error
        ? result.error.status && result.error.status < 500
          ? "failed"
          : "uncertain"
        : "accepted";
    },
  };
}

export async function runAccountCommand(
  input: unknown,
): Promise<AccountResult> {
  try {
    const actor = await accountActor();
    if (!actor)
      return {
        ok: false,
        message: "Use your Administrator role to manage users.",
      };
    const command = parseAccountCommand(input);
    if (!command)
      return {
        ok: false,
        message: "Check the name, roles and project assignments.",
      };
    const result = await executeAccountCommand(command, actor, gateway());
    if (result.ok && command.type === "save" && command.id === actor.userId) {
      const current = await readSession();
      const before = [...(current?.context.roles ?? [])].sort().join(",");
      if (before !== [...command.draft.roles].sort().join(","))
        return { ...result, signInRequired: true };
    }
    return result;
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      if (error.code === "40001")
        return {
          ok: false,
          conflict: true,
          message:
            "The account changed. Your draft is preserved. Review the latest account and reapply your changes.",
        };
      if (error.code === "42501")
        return {
          ok: false,
          message: "Your Administrator access changed. Sign in again.",
        };
      if (error.code === "23505")
        return {
          ok: false,
          message:
            "This email or retry identity is already registered. Retry the original request or use another email.",
        };
      if (error.code === "23514")
        return {
          ok: false,
          message:
            "Keep a signed-in active Administrator, retain your own Administrator role, and check the account's status and assignments.",
        };
    }
    return {
      ok: false,
      message:
        "The operation could not finish. Retry the same request to safely reconcile it.",
    };
  }
}
