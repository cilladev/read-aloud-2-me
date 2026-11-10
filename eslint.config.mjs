// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

// The layers in src/ and what each may import. Pure layers never touch the vscode API,
// so they run in plain Node unit tests.
const PURE_LAYERS = ["src/text/**", "src/speech/**", "src/session/**"];

export default tseslint.config(
  {
    ignores: ["dist/**", "out/**", ".vscode-test/**", "node_modules/**", "docs/**", "*.vsix"],
  },

  js.configs.recommended,

  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Names: camelCase values, PascalCase types, UPPER_CASE constants.
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "default", format: ["camelCase"], leadingUnderscore: "allow" },
        { selector: "variable", format: ["camelCase", "UPPER_CASE", "PascalCase"] },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "enumMember", format: ["PascalCase"] },
        { selector: "objectLiteralProperty", format: null },
        { selector: "import", format: ["camelCase", "PascalCase"] },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

      // One way to do things.
      "no-restricted-syntax": [
        "error",
        { selector: "ExportDefaultDeclaration", message: "Use named exports." },
        { selector: "TSEnumDeclaration", message: "Use a union of string literals." },
      ],
      "no-console": "error",
      eqeqeq: ["error", "always"],
      curly: "error",
      "prefer-const": "error",
      "no-implicit-coercion": "error",
      "max-lines": ["warn", { max: 300, skipBlankLines: true, skipComments: true }],

      // Child processes run with an argument list, never a shell string.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "child_process",
              importNames: ["exec", "execSync"],
              message: "Use spawn or execFile with an argument list.",
            },
            {
              name: "node:child_process",
              importNames: ["exec", "execSync"],
              message: "Use spawn or execFile with an argument list.",
            },
          ],
        },
      ],
    },
  },

  // Pure layers: no vscode API, so they stay unit-testable in plain Node.
  {
    files: PURE_LAYERS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "vscode", message: "This layer is pure. Pass values in from commands/ or platform/." },
            { name: "child_process", importNames: ["exec", "execSync"], message: "Use spawn or execFile." },
            { name: "node:child_process", importNames: ["exec", "execSync"], message: "Use spawn or execFile." },
          ],
        },
      ],
    },
  },

  // The text layer turns text into sentences: no processes, no files, no network.
  {
    files: ["src/text/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["vscode"],
          patterns: [
            { group: ["node:*", "child_process", "fs", "http", "https", "net"], message: "src/text is pure." },
          ],
        },
      ],
    },
  },

  // Nothing ever goes over the network.
  {
    files: ["src/**"],
    ignores: ["src/test/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Read Aloud 2 Me never sends text off the computer." },
      ],
    },
  },

  // Tests may use console and longer files.
  {
    files: ["src/test/**"],
    rules: {
      "no-console": "off",
      "max-lines": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // Build and config scripts in plain JS.
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "writable",
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },

  // Webview scripts run in the browser, not Node.
  {
    files: ["media/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        Element: "readonly",
        HTMLElement: "readonly",
        acquireVsCodeApi: "readonly",
      },
    },
  },

  prettier,
);
