// Integration tests: run inside a real VS Code with the extension loaded.
import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  label: "integration",
  files: "out/test/integration/**/*.test.js",
  version: "stable",
  mocha: { ui: "bdd", timeout: 20000 },
});
