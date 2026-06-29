# Shared-Services Federation — Structural Design (Counsel-Ready Baseline)

## Preamble

**One sentence (charter preamble):** *Worker-proportional for shared operations, equal-node only as a constitutional brake, local sovereignty over everything that most affects workers' actual lives — and a guaranteed exit.*

**Design principle:** *Enumerated powers delegated upward; sovereignty retained below.* The operating worker co-ops are sovereign. They delegate a short, explicit list of powers to a shared-services entity they own. Everything not delegated stays local. The federation is a servant billing for its costs, structurally incapable of becoming the master.

**Why square-root weighting is the default (state this in the charter):** Operational votes are weighted by the **square root** of each co-op's worker-member count. This is not a compromise between worker-proportionality and entity-equality — under the Penrose square-root law it is the weighting that **equalizes the *a priori* voting power (Banzhaf power) of the individual worker across nodes of unequal size**, so a worker in a 500-person node and a worker in a 5-person node have approximately equal probability of being decisive on a federation vote. Square-root weighting is therefore the *truest* expression of one-worker-one-vote once workers are grouped into blocs, and it avoids the arbitrary-threshold gaming that a banded curve invites.

---

## 1. The three powers, three different rules

"Ownership" bundles three powers. Governing each with the right rule is what lets worker-proportionality be the engine without becoming domination.

| Power | What it covers | Governing rule |
|---|---|---|
| **Operational** | Platform fee, budget, service standards, hiring/firing platform staff, day-to-day shared operations | **Worker-proportional** (√ weighting + cap) |
| **Constitutional** | The voting formula itself, the charter, admitting/expelling members, dissolving, amending the reserved-domain list | **Double lock**: worker-supermajority *and* majority of distinct co-ops |
| **Reserved (sovereign)** | Wages/patronage, who to hire as worker-members, whether to take a given job, internal governance, leaving the federation | **Not delegated at all** — stays 100% local |

---

## 2. The voting engine — square-root worker weighting, capped

**Base:** each member co-op's operational votes = a workable integer scaling of **√(its verified worker-member count)**, rounded by a defined rule (e.g., largest-remainder) into whole vote/delegate units.

**Worked example (raw √ shares vs. linear):**

| Co-op | Workers | Linear share | √ weight | √ share |
|---|---|---|---|---|
| Cleaning A | 6 | 7% | 2.45 | 17% |
| Cleaning B | 20 | 23% | 4.47 | 30% |
| Janitorial C | 60 | 70% | 7.75 | 53% |
| **Total** | 86 | | 14.67 | |

Linear hands the 60-person node 70% — instant domination. Square-root cuts it to 53% while still honoring that 60 workers ≠ 6 workers. The cap then finishes the anti-domination job.

**Cap (drafting baseline): one-third (33⅓%).** No single co-op may exceed one-third of total operational votes regardless of √ weight; the surplus redistributes to the others by √ weight. **Counsel/organizers to evaluate** an auto-scaling variant — *"no node may exceed the combined votes of the next two largest nodes"* — which is brutal on a giant in a small federation and naturally relaxes as nodes join, avoiding the need to re-tune the cap as N changes.

**The small-N property (important — write into the charter so no one panics):** In a *small* federation the operational cap does little useful work, and that is by design. With only 3 nodes a flat one-third cap mathematically forces all three toward ~33% each — i.e., it collapses √ weighting back toward equal-entity voting; the "next-two-combined" variant swings the other way and permits the largest up to ~50%. **No cap rule resolves the proportionality-vs-domination tension cleanly at very small N**, because that tension is sharpest when there are fewest players. The operational cap is therefore **mature-federation insurance** — it begins doing real work only around **N ≥ ~6**, when genuine coalitions can form. The infant federation's anti-domination protection is carried instead by the other three locks: **reserved domains** (§4), the **constitutional double-lock** (§3, Tier 3), and **guaranteed exit** (§8). The cap looking toothless at three nodes is correct, not broken.

**Apportionment cadence (required because √ is continuous):** Because votes are a continuous function of headcount, weights must be **recalculated and fixed on a stated interval** (recommend annually at the AGM, or quarterly) against a **defined, verified snapshot** of each co-op's worker-member count, and held constant between recomputations. This closes the gaming surface: a node cannot time a hire/departure to swing a specific vote, because the only date that matters is the bright-line snapshot date. (This is the √-equivalent of the banded curve's boundary-gaming — relocated from "where's the threshold" to "when's the snapshot," which a fixed date solves.)

---

## 3. Decision tiers — escalating locks

- **Tier 1 — Operational (simple majority of weighted votes).** Routine platform operations; budgets within approved policy; standard vendor decisions.
- **Tier 2 — Policy (60% of weighted votes).** Setting or changing the platform fee; admitting a new member co-op; the annual budget; major capital expenditure.
- **Tier 3 — Constitutional (DOUBLE LOCK).** Requires **75% of weighted votes AND a majority of member co-ops counted equally** (a concurrent majority). Covers: amending the charter, changing the voting formula or the cap, expelling a member, dissolving the federation, or altering the reserved-domain list.

Tier 3 is the *only* place equal-entity voting re-enters — as a brake, not a base. A node with 49% of the workforce cannot amend the constitution, because it also needs a majority of the *other* nodes. This is the precise anti-steamroll mechanism.

---

## 4. Reserved domains — the subsidiarity lock (the real guarantee)

The federation **constitutionally cannot decide** the following. They are reserved irreducibly to each local co-op:

1. **Wages, pay scales, and internal patronage** of the local.
2. **Who is hired/admitted** as a worker-member, and the process for it.
3. **Internal governance** of the local (its board, its bylaws, its meetings).
4. **Whether to accept or decline** any specific job or client.
5. **Whether to remain in or leave** the federation (exit is always available — §8).

You can't be steamrolled on a decision the center has no jurisdiction to make. This list can only be *expanded* by Tier 1/2 and only *contracted* by Tier 3 (double lock) — easy to give locals more sovereignty, hard to take it away.

---

## 5. Board of the shared-services entity

- **Delegates, recallable by their own co-op.** Each member co-op appoints its board delegate(s) and may recall and replace them at will. The local controls its delegate — own-it-from-below at the board level.
- **Floor + √ seats, capped.** Every member co-op gets **at least 1 seat** (guaranteed voice). Additional seats scale on √ weighting, subject to the **one-third cap** on any single co-op's board seats.
- **Rotating or elected chair**, with no node holding the chair indefinitely.

---

## 6. Economics — at-cost, surplus returned (denies the center a profit motive)

- The shared-services entity operates **at cost** (a cost-sharing cooperative), not for profit. It bills member co-ops a platform fee (cost-plus-buffer, per-seat, or % of revenue — chosen by Tier 2 vote).
- **Any surplus returns to member co-ops as patronage, allocated by *usage*** (how much each co-op used the shared services). Three different bases, all intentional:
  - **Voting weight** = √ worker count.
  - **Patronage** = usage of shared services.
  - **Capital contribution** = membership buy-in (§7).
- Because surplus flows back to the nodes and the center can't accumulate profit, the platform has **no economic engine to grow its own power** — an anti-domination safeguard independent of the voting rules.

---

## 7. Capital and ownership

- **Members = the operating worker co-ops** (a true secondary / "co-op of co-ops"). Not individual workers, not customers. Workers exercise their federation voice **through** their co-op, which they democratically control — the cleanest expression of "owned from below by the co-ops." (Direct individual federation membership was considered and rejected: it dissolves the own-it-from-below logic and pushes toward a centralized multi-stakeholder structure.)
- Each member co-op holds a **membership share** (buy-in), possibly with a usage-scaled capital account. Equity ultimately rests with the member co-ops.
- **Outside/community capital** (if any) enters as **non-voting** or strictly vote-capped instruments — never controlling.

---

## 8. Exit rights — credible exit is the ultimate check

- Any co-op may **leave with its worker-members, its customer relationships, and its data.** Data portability is mandated in the charter (machine-readable export of the leaving co-op's customers, schedules, and history).
- **No permanent exclusivity**, or any exclusivity sunsets. Low exit cost keeps the platform permanently accountable: if it turns extractive, nodes leave and it dies. The threat of exit disciplines the center more reliably than any vote — which is why exit is named in the preamble, not buried here.

---

## 9. The founder handover — constitutional sunset (written at genesis)

Because the platform is built *before* the co-ops that will own it exist, the genesis window must encode the founder's own sunset so it does not depend on future goodwill:

1. **Build capital enters as a repaid, non-extractive loan** (Seed-Commons style — repaid from platform fees), **not as permanent controlling stock.**
2. **Pre-set transfer trigger:** control passes from the founder to the worker-proportional assembly upon the *first* of — (a) **N member co-ops** exist, (b) **M total worker-members** across the federation, or (c) **date D**. Set N/M/D in drafting.
3. **Interim stewardship is hard-capped.** Before the trigger, the founder holds a temporary steward role with a firm sunset; the earliest member co-ops hold **veto rights over any constitutional change** even during the interim, so the structure can't be locked against them while they're small.
4. **Post-trigger**, the founder's role becomes a **recallable delegated position** like any other — votable out, consistent with the whole premise.

This is "the guide who leads them through and steps back," made enforceable rather than promised.

---

## 10. Legal vehicle (California) — and the questions only counsel can close

**Recommended:** the federation = a **California cooperative corporation** (general, Corp. Code §12200 et seq.) whose **members are the operating worker co-ops**. The operating nodes are AB 816 *worker* cooperatives (members = individual workers, one-worker-one-vote, as their statute requires). The federation is a *secondary* co-op (members = entities), so it is **not** itself an AB 816 worker co-op.

**Confirm with co-op counsel (e.g., SELC) before drafting:**

1. **Weighted voting latitude — load-bearing.** AB 816 mandates one-worker-one-vote for *worker* co-ops. The federation is a *general* cooperative corporation whose members are co-ops — confirm the statute's permitted latitude to weight member votes by √(worker count) with a cap. The whole design assumes the secondary entity may weight votes where a primary worker co-op may not. **Do not assume — verify.**
2. **Fallback if raw weighted member voting is constrained.** If the statute limits weighted *member* voting, push the weighting down into **board-delegate apportionment** (seats by √, recallable by locals) rather than raw member votes — same power distribution, different legal mechanism. Ask counsel both questions in one sitting.
3. **Entity form.** General cooperative corporation vs. multi-stakeholder co-op vs. nonprofit mutual-benefit corporation as the federation shell. (Pure secondary co-op recommended.)
4. **Tax.** Subchapter T treatment for the secondary co-op (patronage by usage); patronage timing; franchise-tax exposure.
5. **Securities.** Whether member buy-ins / community capital at the *federation* level fit an exemption analogous to the operating-co-op §25100(r) path.

---

## Locked baseline (summary)

- **Members:** operating worker co-ops only; workers vote *through* their co-op.
- **Operational voting:** √-worker weighting, recomputed on a fixed interval against a verified snapshot, rounded to workable vote/delegate units.
- **Cap:** draft at one-third; counsel to evaluate the "no node exceeds the next-two-combined" auto-scaling variant. Cap is mature-federation insurance (works at N≥~6); small-N protected by reserved domains + double-lock + exit.
- **Constitutional decisions:** 75% weighted + majority of co-ops (double lock).
- **Reserved domains:** wages, hiring, job acceptance, internal governance, exit — never delegated.
- **Board:** one-seat floor per co-op + capped √ additions, delegates recallable by locals.
- **Economics:** at-cost shared services, usage-based patronage return.
- **Founder:** temporary steward with automatic genesis-set sunset trigger; thereafter recallable.
- **Exit:** guaranteed, with data portability — named in the preamble.

**The platform is owned from below because the powers that matter most were never delegated, and the ones that were can be reclaimed.**
