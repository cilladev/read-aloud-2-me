import * as assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Checks the conventions in AGENTS.md that lint can't: names in package.json, the README, file names.

const ROOT = join(__dirname, "..", "..", "..");
const PREFIX = "readAloud2Me.";

interface Manifest {
  extensionKind?: string[];
  contributes: {
    commands?: { command: string; title: string; category?: string }[];
    configuration?: { properties?: Record<string, { description?: string; markdownDescription?: string }> };
    keybindings?: { command: string }[];
  };
}

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Manifest;
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const commands = manifest.contributes.commands ?? [];
const settings = Object.entries(manifest.contributes.configuration?.properties ?? {});

describe("package.json conventions", () => {
  it("runs on the user's own machine, also in remote windows", () => {
    assert.deepEqual(manifest.extensionKind, ["ui"]);
  });

  it("prefixes every command id with readAloud2Me.", () => {
    for (const { command } of commands) {
      assert.ok(command.startsWith(PREFIX), command);
    }
  });

  it("puts every command in the Read Aloud 2 Me category", () => {
    for (const { command, category } of commands) {
      assert.equal(category, "Read Aloud 2 Me", command);
    }
  });

  it("binds keys only to contributed commands", () => {
    const ids = new Set(commands.map((c) => c.command));
    for (const { command } of manifest.contributes.keybindings ?? []) {
      assert.ok(ids.has(command), `keybinding for unknown command ${command}`);
    }
  });

  it("prefixes and describes every setting", () => {
    for (const [key, schema] of settings) {
      assert.ok(key.startsWith(PREFIX), key);
      assert.ok(schema.description ?? schema.markdownDescription, `${key} has no description`);
    }
  });
});

describe("README", () => {
  it("lists every setting", () => {
    for (const [key] of settings) {
      assert.ok(readme.includes(`\`${key}\``), `README is missing ${key}`);
    }
  });

  it("lists every command", () => {
    for (const { title } of commands) {
      assert.ok(readme.includes(title), `README is missing the command "${title}"`);
    }
  });
});

describe("source files", () => {
  it("use kebab-case names", () => {
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)*$/;
    const files = readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" });
    for (const file of files) {
      for (const part of file.split(/[\\/]/)) {
        assert.match(part, kebab, `src/${file}`);
      }
    }
  });
});
