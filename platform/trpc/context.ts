// tRPC context — sector-agnostic (ADR-0001). Resolves the session from the Authorization
// header; the session is optional (public procedures) or enforced by authedProcedure.
// coOpId is NEVER in the context for app-facing routes — it is resolved inside
// withSessionTx from the live session row (ADR-0004 §3).
import { resolveSession, type SessionContext } from "../identity/session";

export interface Context {
  token: string | null;
  session: SessionContext | null;
}

export async function createContext(opts: {
  req: { headers: { get(name: string): string | null } };
}): Promise<Context> {
  const auth = opts.req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { token: null, session: null };
  const session = await resolveSession(token);
  return { token, session };
}
