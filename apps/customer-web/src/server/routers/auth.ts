// Auth router (app layer — allowed to import platform + sectors per ADR-0003).
// register: creates a users row (role=customer) + session. No customers row — that
// happens at first booking. login: verifies password + creates session. logout: revokes.
// Registration resolves co_op_id from a co-op slug (server-side, never from client trust).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, authedProcedure } from "@comop/platform/trpc/server";
import { hashPassword, verifyPassword } from "@comop/platform/identity/password";
import { createSession, revokeSession } from "@comop/platform/identity/session";
import { withCoOpTx } from "@comop/platform/identity/coop-resolve";

const registerSchema = z.object({
  coOpSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  coOpSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = router({
  register: publicProcedure.input(registerSchema).mutation(async ({ input }) => {
    const passwordHash = hashPassword(input.password);
    try {
      const result = await withCoOpTx(input.coOpSlug, async (tx, coOpId) => {
        const r = await tx.query(
          `INSERT INTO users (co_op_id, role, email, password_hash) VALUES ($1, 'customer', $2, $3)
           RETURNING id`,
          [coOpId, input.email, passwordHash],
        );
        return { userId: r.rows[0].id as string, coOpId };
      });
      const { token } = await createSession(result.userId, result.coOpId);
      return { token };
    } catch (err) {
      if (err instanceof Error && err.message.includes("duplicate key")) {
        throw new TRPCError({ code: "CONFLICT", message: "email already registered" });
      }
      throw err;
    }
  }),

  login: publicProcedure.input(loginSchema).mutation(async ({ input }) => {
    try {
      const result = await withCoOpTx(input.coOpSlug, async (tx, coOpId) => {
        const r = await tx.query(
          "SELECT id, password_hash FROM users WHERE email = $1 AND co_op_id = $2",
          [input.email, coOpId],
        );
        if (r.rowCount === 0) throw new TRPCError({ code: "UNAUTHORIZED", message: "invalid credentials" });
        return {
          userId: r.rows[0].id as string,
          storedHash: r.rows[0].password_hash as string | null,
          coOpId,
        };
      });
      if (!result.storedHash || !verifyPassword(input.password, result.storedHash)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "invalid credentials" });
      }
      const { token } = await createSession(result.userId, result.coOpId);
      return { token };
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw err;
    }
  }),

  logout: authedProcedure.mutation(async ({ ctx }) => {
    await revokeSession(ctx.token);
    return { ok: true };
  }),
});
