// @comop/platform — sector-agnostic core (identity, ledger, allocation, payments,
// dispatch, compliance, governance, transparency, notifications, export).
// ADR-0001: knows nothing about any sector. ADR-0003: never imports /sectors or /apps.
export const PLATFORM = "platform" as const;
