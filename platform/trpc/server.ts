// tRPC procedure factories — sector-agnostic (ADR-0001). publicProcedure for
// register/login; authedProcedure enforces a valid session before the handler runs.
// authedProcedure passes ctx.token through; the handler calls withSessionTx(token, …)
// which resolves co_op_id from the session inside the transaction boundary (ADR-0004 §3).
import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

const isAuthenticated = t.middleware(async ({ ctx, next }) => {
  if (!ctx.token || !ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "no valid session" });
  }
  return next({ ctx: { token: ctx.token, session: ctx.session } });
});

export const authedProcedure = t.procedure.use(isAuthenticated);
