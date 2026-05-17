import type { MigrationRule } from "@renatus/shared";

/**
 * Tailwind CSS v3 → v4 Breaking Changes Rule Pack
 *
 * Based on the official Tailwind v4 upgrade guide:
 * https://tailwindcss.com/docs/v4-beta
 *
 * This rule pack covers the 5 highest-value breaking changes that affect
 * the majority of Tailwind codebases during migration from v3 to v4.
 *
 * Detector regexes are tuned to surface real call-sites in HTML / JSX /
 * CSS without false-positives on the common adjacent forms (e.g., Rule 4
 * matches bare `border` / `border-t` but not `border-gray-200` / `border-2`).
 */

export const TAILWIND_3_TO_4_RULES: MigrationRule[] = [
  {
    kind: "migration",
    id: "tailwind-v4-css-import",
    severity: "blocker",
    category: "api-removal",
    title:
      "@tailwind base/components/utilities directives removed — use @import \"tailwindcss\"",
    rationale:
      "Tailwind v4 removed the per-layer @tailwind directives in favor of a single CSS @import. Any v3 entrypoint that still uses @tailwind base/components/utilities will fail to build under v4.",
    fromVersion: "3.x",
    toVersion: "4.x",
    ecosystem: "npm",
    detect: {
      kind: "pattern",
      expr: "@tailwind\\s+(base|components|utilities)\\b",
    },
    fix: {
      kind: "manual",
      instructions:
        "Replace the three `@tailwind base; @tailwind components; @tailwind utilities;` directives with a single `@import \"tailwindcss\";` at the top of your CSS entrypoint.",
    },
  },
  {
    kind: "migration",
    id: "tailwind-v4-opacity-utilities",
    severity: "breaking",
    category: "api-removal",
    title:
      "Per-utility opacity classes (bg-opacity-*, text-opacity-*, …) removed",
    rationale:
      "Tailwind v4 removed the dedicated *-opacity-* utilities in favor of the unified color/opacity slash syntax. Existing v3 markup that pairs `bg-black` with `bg-opacity-50` no longer applies any opacity in v4.",
    fromVersion: "3.x",
    toVersion: "4.x",
    ecosystem: "npm",
    detect: {
      kind: "pattern",
      expr: "\\b(bg|text|border|divide|placeholder|ring)-opacity-\\d+\\b",
    },
    fix: {
      kind: "manual",
      instructions:
        "Use color/opacity slash syntax instead. `bg-black bg-opacity-50` → `bg-black/50`. `text-white text-opacity-75` → `text-white/75`.",
    },
  },
  {
    kind: "migration",
    id: "tailwind-v4-shadow-rename",
    severity: "breaking",
    category: "api-rename",
    title: "Shadow scale renamed (shadow-sm → shadow-xs, shadow → shadow-sm)",
    rationale:
      "Tailwind v4 shifted the shadow scale to align with the rest of the design system. Visual regressions appear silently when the legacy names continue to apply but resolve to different physical values.",
    fromVersion: "3.x",
    toVersion: "4.x",
    ecosystem: "npm",
    detect: {
      kind: "pattern",
      expr: "\\bshadow(-(?:sm|md|lg|xl|2xl|inner|none))?\\b",
    },
    fix: {
      kind: "manual",
      instructions:
        "`shadow-sm` is now `shadow-xs`; `shadow` is now `shadow-sm`; `shadow-md` is now `shadow-md` (unchanged); other names shifted similarly. See the upgrade guide.",
    },
  },
  {
    kind: "migration",
    id: "tailwind-v4-default-border-color",
    severity: "warning",
    category: "config-change",
    title:
      "Default border color changed from gray-200 to currentColor",
    rationale:
      "Tailwind v4 sets the default border color to `currentColor` instead of the v3 implicit `gray-200`. Existing markup that uses a bare `border` / `border-t` / `border-x` without an explicit color modifier will render with the surrounding text color in v4.",
    fromVersion: "3.x",
    toVersion: "4.x",
    ecosystem: "npm",
    detect: {
      kind: "pattern",
      expr: "\\bborder(-(?:t|r|b|l|x|y|s|e))?\\b(?!-[a-z0-9])",
    },
    fix: {
      kind: "manual",
      instructions:
        "In v4, `border` defaults to `currentColor`. If you relied on the implicit `gray-200`, explicitly add `border-gray-200` (or your design system color).",
    },
  },
  {
    kind: "migration",
    id: "tailwind-v4-transform-filter-implicit",
    severity: "info",
    category: "deprecation",
    title:
      "transform / filter / backdrop-filter utilities no longer required",
    rationale:
      "Tailwind v4 applies the transform / filter / backdrop-filter property automatically whenever a related utility (translate-*, scale-*, blur-*, etc.) is used. The standalone enablers from v3 are now redundant and can be removed.",
    fromVersion: "3.x",
    toVersion: "4.x",
    ecosystem: "npm",
    detect: {
      kind: "pattern",
      expr: "\\b(transform|filter|backdrop-filter)\\b",
    },
    fix: {
      kind: "manual",
      instructions:
        "In v4, transform/filter utilities apply automatically when any related utility is used. The standalone `transform`, `filter`, `backdrop-filter` classes are no longer required and can be removed.",
    },
  },
];

// Made with Bob
