# ADR-0003: Platform may not import from `/sectors/*` — enforced in CI (release-blocking)

- **Status:** Accepted
- **Date:** genesis (N=1)
- **Context:** The dependency law that makes the platform liftable is one-directional: **local/sector modules depend on platform modules; platform modules never depend on sector modules.** This is load-bearing for the entire federation path and erodes silently under deadline pressure. Principles in a doc are not enough — the boundary must fail builds.

## Decision
**Any import from `/platform/**` that references `/sectors/**` fails CI and is a release-blocking violation.**

- Direction allowed: `/sectors/* → /platform` and `/apps/* → {/platform, /sectors/*}`.
- Direction banned: `/platform → /sectors/*` (and `/platform` must not reference any specific sector by name).
- Enforcement options (pick per stack): ESLint `no-restricted-imports` / `import/no-restricted-paths`, dependency-cruiser, or Nx module-boundary tags. The rule runs in CI on every PR; a violation blocks merge.

### Example (`import/no-restricted-paths`)
```json
{
  "import/no-restricted-paths": ["error", {
    "zones": [
      { "target": "./platform", "from": "./sectors",
        "message": "ADR-0003: platform must not import from sectors. If platform needs this, it belongs behind the sector-adapter interface, not imported directly." }
    ]
  }]
}
```

## Consequences
- Wrong-direction coupling is caught **mechanically**, before review, on every PR.
- This ADR catches dependency *direction*; ADR-0001's review question catches the subtler case of cleaning-specific logic that sits in `/platform` without importing anything from `/sectors`. Both are required; neither alone is sufficient.
- If a future change genuinely needs platform→sector data flow, the answer is to **widen the sector-adapter interface** (a reviewed, deliberate act), never to relax this rule.
