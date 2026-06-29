// Flat ESLint config. ADR-0003 mechanical enforcement layer:
// platform/** may not import from sectors/** or apps/** (release-blocking).
// The zero-dependency architectural test (tools/check-boundaries.mjs) is the
// second, required layer (ADR-0001) — it catches sector-specific code that sits
// in /platform without importing anything.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/build/**"] },
  ...tseslint.configs.recommended,
  {
    // ADR-0003: the dependency law, scoped to platform source files.
    files: ["platform/**/*.ts", "platform/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: [
              "**/sectors/**", "**/sectors/*",
              "../sectors/**", "../../sectors/**", "../../../sectors/**",
              "sectors/**", "@comop/cleaning", "@comop/*-sector"
            ],
            message: "ADR-0003: platform must not import from sectors. Widen the sector-adapter interface, don't import."
          },
          {
            group: [
              "**/apps/**", "../apps/**", "../../apps/**",
              "@comop/customer-web", "@comop/worker"
            ],
            message: "ADR-0001/0003: platform must not depend on apps."
          }
        ]
      }]
    }
  }
);
