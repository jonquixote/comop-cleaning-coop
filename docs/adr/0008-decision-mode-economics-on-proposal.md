# ADR-0008: Decision-mode economics live on the proposal (`transparency_snapshot_json`), carried by reference

- **Status:** Accepted
- **Date:** 2026-06-30 (build-order step 7, before the governance migration)
- **Context:** The valve (impl §6) makes a decision-mode communication "unsendable unless it (a) links a `proposals` row **and** (b) carries that proposal's underlying economics in **computable form** … attached to **the record**." "The record" is ambiguous — the **communication** record, or the **proposal** record? This is the enforcement point of a **mandatory invariant** (§8a: a decision-mode communication without a linked proposal + attached computable economics is rejected at write time), so it must be resolved deliberately before `0010_governance.sql`.

## Decision
**The computable economics live on the PROPOSAL**, in a `transparency_snapshot_json` column. A decision-mode communication satisfies the write-constraint by **linking a proposal whose `transparency_snapshot_json` is non-null** — it carries the economics **by reference** to a single source of truth, not by duplicating a snapshot onto every communication.

- The proposal is the *decision*; its affected `PriceBreakdown` deltas / period-health impact are computed once and stored on it.
- A communication is a *message about* a decision; it inherits the decision's economics through its `proposal_id` link.
- This satisfies impl §6 ("carries that proposal's underlying economics in computable form") — carried by reference — while avoiding drift between a comm's economics and the proposal's.

## Enforcement (write-time, not a guideline)
The constraint is enforced **in the database** by a `BEFORE INSERT` trigger on `communications`: `mode='decision'` requires a non-null `proposal_id` **and** a linked proposal with non-null `transparency_snapshot_json`, else the insert `RAISE`s. `createCommunication` also pre-checks for a clean error, but the **trigger is the guarantee** — a direct `INSERT` cannot bypass it. (The trigger runs as the invoking role under RLS, so it sees only the tenant's proposals — same-tenant by construction.)

## Consequences
- `proposals.transparency_snapshot_json jsonb` (nullable until economics are attached); `communications.proposal_id` FK; the write-time trigger is the invariant's teeth.
- Single source of truth for a decision's economics; "inform, don't steer" is structural — you cannot open the valve on a vote without the math already attached to the proposal it points at.
