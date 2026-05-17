import type { MigrationRule } from "@renatus/shared";

/**
 * React 18 → 19 Breaking Changes Rule Pack
 * 
 * Based on the official React 19 upgrade guide:
 * https://react.dev/blog/2024/04/25/react-19-upgrade-guide
 * 
 * This rule pack covers the 5 highest-value breaking changes that affect
 * the majority of React codebases during migration from v18 to v19.
 */

export const REACT_18_TO_19_RULES: MigrationRule[] = [
  {
    kind: "migration",
    id: "react-19-useref-initial-arg",
    severity: "breaking",
    category: "api-signature-change",
    title: "useRef() now requires an initial argument",
    rationale:
      "React 19 removed the ability to call useRef() without an argument. All useRef calls must now provide an initial value.",
    fromVersion: "18.x",
    toVersion: "19.x",
    ecosystem: "npm",
    detect: {
      kind: "pattern",
      expr: "useRef\\(\\s*\\)",
    },
    fix: {
      kind: "manual",
      instructions:
        "Replace `useRef()` with `useRef(null)` or provide an appropriate initial value based on the ref's usage.",
    },
  },
  {
    kind: "migration",
    id: "react-19-defaultprops-removal",
    severity: "breaking",
    category: "api-removal",
    title: "defaultProps removed for function components",
    rationale:
      "React 19 no longer supports defaultProps on function components. Use ES6 default parameters instead.",
    fromVersion: "18.x",
    toVersion: "19.x",
    ecosystem: "npm",
    detect: {
      kind: "pattern",
      expr: "\\.defaultProps\\s*=",
    },
    fix: {
      kind: "manual",
      instructions:
        "Convert `Component.defaultProps = { prop: value }` to default destructuring in function parameters: `function Component({ prop = value }) { ... }`",
    },
  },
  {
    kind: "migration",
    id: "react-19-string-refs-removal",
    severity: "breaking",
    category: "api-removal",
    title: "String refs removed",
    rationale:
      "React 19 removed support for legacy string refs. Use callback refs or createRef instead.",
    fromVersion: "18.x",
    toVersion: "19.x",
    ecosystem: "npm",
    detect: {
      kind: "pattern",
      expr: 'ref\\s*=\\s*["\']\\w+["\']',
    },
    fix: {
      kind: "manual",
      instructions:
        'Replace string refs like `ref="myRef"` with callback refs `ref={(el) => this.myRef = el}` or use `createRef()` in class components / `useRef()` in function components.',
    },
  },
  {
    kind: "migration",
    id: "react-19-reactdom-render-removal",
    severity: "blocker",
    category: "api-removal",
    title: "ReactDOM.render removed - must use createRoot",
    rationale:
      "React 19 removed the legacy ReactDOM.render API. All applications must migrate to the concurrent rendering API using createRoot.",
    fromVersion: "18.x",
    toVersion: "19.x",
    ecosystem: "npm",
    detect: {
      kind: "pattern",
      expr: "ReactDOM\\.render\\s*\\(",
    },
    fix: {
      kind: "manual",
      instructions:
        "Replace `ReactDOM.render(<App />, container)` with `const root = ReactDOM.createRoot(container); root.render(<App />)`. Import createRoot from 'react-dom/client'.",
    },
  },
  {
    kind: "migration",
    id: "react-19-proptypes-removal",
    severity: "warning",
    category: "api-removal",
    title: "PropTypes removed from function components",
    rationale:
      "React 19 no longer reads PropTypes on function components. Use TypeScript or runtime validation libraries instead.",
    fromVersion: "18.x",
    toVersion: "19.x",
    ecosystem: "npm",
    detect: {
      kind: "pattern",
      expr: "\\.propTypes\\s*=",
    },
    fix: {
      kind: "manual",
      instructions:
        "Remove PropTypes definitions and migrate to TypeScript interfaces or use a runtime validation library like Zod. PropTypes are still supported on class components but deprecated.",
    },
  },
];

// Made with Bob
