// Lint rules (see AGENTS.md "Lint"). Run with `bun run lint`.

import jsdoc from "eslint-plugin-jsdoc"
import tseslint from "typescript-eslint"
import local from "./tools/eslint/rules.mjs"

// "A function" = anything with its own name. Inline callbacks (`xs.map(x => x * 2)`) are exempt.
const NAMED_FUNCTIONS = [
  "FunctionDeclaration",
  "MethodDefinition",
  "VariableDeclarator > ArrowFunctionExpression",
  "VariableDeclarator > FunctionExpression",
  "PropertyDefinition > ArrowFunctionExpression",
  "PropertyDefinition > FunctionExpression",
]

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "runs/**",
      ".cache/**",
      "examples/**/models/**",
      "src/report/client/**/*.generated.*",
    ],
  },
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { "@typescript-eslint": tseslint.plugin, jsdoc, local },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message:
            "Enums are not allowed. Use a string-literal union (type Mode = 'a' | 'b') or an `as const` object.",
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // 2. Every named function has a JSDoc comment and fully typed signature.
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: { FunctionDeclaration: false },
          contexts: NAMED_FUNCTIONS,
          checkConstructors: false,
          checkGetters: true,
          checkSetters: true,
        },
      ],
      "local/typed-signature": "error",
      // 4. Files over 500 lines warn; important files may opt out with a disable comment and a reason.
      "local/max-file-lines": "warn",
    },
  },
  {
    // Preserve the upstream RFC examples' existing function signatures.
    files: ["examples/**/*.tsx"],
    rules: { "jsdoc/require-jsdoc": "off", "local/typed-signature": "off" },
  },
  {
    // 5. One test file per source file: tests/<module>/<name>.test.ts tests src/<module>/<name>.ts.
    files: ["tests/**/*.test.{ts,tsx,mjs}"],
    rules: { "local/test-file-matches-source": "error" },
  },
)
