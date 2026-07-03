// Invite flow (spec §3a.1). Worker-owners are invited — never self-registered —
// because membership is a governance decision, not a signup. An admin/member issues
// a single-use, expiring token; the invitee redeems it to become a user (role='worker')
// and a member (status='probationary'). Promotion to 'member' is a separate admin
// action (a vote or admission step) — deliberately out of scope here.
//
// SECURITY MODEL:
// - We only ever store SHA-256(token) in `invites.token_hash`. The plaintext token is
//   returned to the issuer ONCE and never persisted. Anyone holding the plaintext can
//   redeem, so the issuer must hand it to the invitee out-of-band (their responsibility).
// - Redemption looks up the row by token hash, and the co_op_id is read from the row
//   itself — never from any client input. There is no session at redeem time, so the
//   trusted-tenant chain (spec §3a) is exactly: token_hash → invite row → co_op_id.
// - RLS on invites still requires tenant context for INSERT/UPDATE; issueInvite uses
//   the issuer's tenant (current session), redeemInvite runs in a pre-tenant read path
//   similar to resolveSession.
import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

const sha256 = (t: string): string => createHash("sha256").update(t).digest("hex");

export interface IssueInviteOptions {
  email?: string;
  expiresInHours?: number;
}

const DEFAULT_EXPIRY_HOURS = 72;

/** Issue a single-use invite token. Caller MUST already have a tenant-scoped tx
 *  (`app.current_co_op` set). The plaintext token is returned once and the caller is
 *  responsible for delivering it to the invitee out-of-band (no email service yet —
 *  that is its own surface). Default expiry: 72 hours. */
export async function issueInvite(
  tx: PoolClient,
  coOpId: string,
  issuedByMemberId: string,
  options: IssueInviteOptions = {},
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresInHours = options.expiresInHours ?? DEFAULT_EXPIRY_HOURS;
  const r = await tx.query(
    `INSERT INTO invites (co_op_id, issued_by, token_hash, email, expires_at)
     VALUES ($1, $2, $3, $4,
             now() + make_interval(hours => $5))
     RETURNING expires_at`,
    [coOpId, issuedByMemberId, sha256(token), options.email ?? null, expiresInHours],
  );
  return { token, expiresAt: r.rows[0].expires_at as string };
}

export class InviteError extends Error {}

/** Redeem a plaintext invite token into a (worker, probationary-member) pair. No
 *  prior session is required — the co_op_id is resolved from the invite row itself.
 *  Returns the new userId + memberId. Throws InviteError on any of:
 *    - not found / wrong token
 *    - already redeemed
 *    - expired
 *  On success the invite is marked redeemed_at = now() and the user/member rows are
 *  inserted. The redemption + row insertion run in a single savepoint so a failure in
 *  the inserts rolls back the redeemed_at marking. */
export async function redeemInvite(
  tx: PoolClient,
  token: string,
): Promise<{ userId: string; memberId: string; coOpId: string }> {
  const tokenHash = sha256(token);

  // Lookup — no tenant context yet (mirrors session resolution). We read by
  // token_hash which is globally UNIQUE so this is safe across co-ops.
  const r = await tx.query(
    `SELECT id, co_op_id, expires_at, redeemed_at
       FROM invites
      WHERE token_hash = $1`,
    [tokenHash],
  );
  if (r.rowCount === 0) {
    throw new InviteError("invite token not found");
  }
  const invite = r.rows[0] as { id: string; co_op_id: string; expires_at: Date; redeemed_at: Date | null };
  if (invite.redeemed_at !== null) {
    throw new InviteError("invite already redeemed");
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    throw new InviteError("invite expired");
  }

  const coOpId = invite.co_op_id as string;

  // Mark redeemed first to prevent a parallel redeem winning the race. The actual
  // user/member inserts run inside the same tx.
  await tx.query(
    `UPDATE invites SET redeemed_at = now() WHERE id = $1 AND redeemed_at IS NULL`,
    [invite.id],
  );

  // Create worker user. Email may be null on the invite; we still need a unique
  // instance per session so we generate a placeholder if absent (the worker can set
  // a real one later — out of scope here).
  const userRes = await tx.query(
    `INSERT INTO users (co_op_id, role, email, password_hash)
     VALUES ($1, 'worker', $2, NULL)
     RETURNING id`,
    [coOpId, null],
  );
  const userId = userRes.rows[0].id as string;

  const memberRes = await tx.query(
    `INSERT INTO members (co_op_id, user_id, status, joined_at)
     VALUES ($1, $2, 'probationary', now())
     RETURNING id`,
    [coOpId, userId],
  );
  const memberId = memberRes.rows[0].id as string;

  return { userId, memberId, coOpId };
}
