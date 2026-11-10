# AGENTS.md

How to work on Read Aloud 2 Me. These rules are for every contributor, human or agent. The checks in `npm run verify` enforce most of them; the rest are reviewed in pull requests.

## What this is

A VS Code extension. The user selects text, presses `Cmd+'` (Mac) or `Ctrl+'` (Windows), and hears it in the computer's own voice. Offline. Markdown is cleaned before it is read. The product brief is [docs/brief.md](docs/brief.md); the clickable prototype is [docs/prototype.html](docs/prototype.html).

Three promises shape every change:

- **Text stays on the computer.** No network calls, no telemetry, no cloud voices.
- **Only installed voices.** macOS voices through `say`, Windows voices through PowerShell.
- **It runs where the speakers are.** `extensionKind` is `["ui"]`, so in SSH, WSL and container windows it still runs on the user's own machine.

## Commands

| Command                                     | What it does                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm ci`                                    | Install exactly what `package-lock.json` lists                                      |
| `npm run watch`                             | Rebuild and type-check on save. F5 in VS Code starts the Extension Development Host |
| `npm run compile`                           | Type-check, lint, bundle to `dist/extension.js`                                     |
| `npm run lint` / `npm run lint:fix`         | ESLint                                                                              |
| `npm run format` / `npm run format:check`   | Prettier                                                                            |
| `npm run test:unit`                         | Mocha in plain Node, for `src/text` and `src/speech`                                |
| `npm run test:integration`                  | Tests inside a real VS Code (`@vscode/test-cli`)                                    |
| `npm run verify`                            | Everything CI runs. **Run it before calling any change done.**                      |
| `npm run coverage`                          | Unit tests with coverage; fails under 90% lines for `text/`, `session/`, `speech/`  |
| `READ_ALOUD_E2E=1 npm run test:integration` | Also runs the real-speech tests (they make sound). macOS or Windows only            |
| `npm run vsix`                              | Build `read-aloud-2-me.vsix`                                                        |
| `./install.sh` / `.\install.ps1`            | Build and install into VS Code; pass `cursor`, `windsurf` or `codium` for a fork    |

Node 22 or later (`.nvmrc`).

## Layout

```
src/
  extension.ts        activate() and deactivate(): wiring only, no logic
  commands/           one file per command; the only code that reads the editor selection
  speech/             speaking: the SpeechEngine interface, one file per platform, the engine picker
  text/               turning text into sentences: Markdown cleaning, sentence splitting
  session/            the reading state machine: current sentence, pause, next, previous
  reader/             the reader panel (webview host side)
  ui/                 status bar item, player, quick picks
  config/             typed reading of readAloud2Me.* settings
  test/
    unit/             plain Node tests; mirror the src/ path: test/unit/text/markdown.test.ts
    integration/      tests that need VS Code
media/                files the webview loads: reader.css, reader.js, icons
resources/            files the extension runs: speech-host.ps1 (the Windows speech host)
docs/                 brief, prototype, research notes; never shipped
dist/                 the bundle (generated, git-ignored)
out/                  compiled tests (generated, git-ignored)
```

### Layer rules

Dependencies point one way: `extension.ts` → `commands/` → `ui/`, `reader/`, `session/`, `speech/`, `text/`, `config/`. `session/` may import types from `speech/` and `text/`.

| Folder                                   | May import `vscode` | May spawn processes                  | Unit-tested in plain Node |
| ---------------------------------------- | ------------------- | ------------------------------------ | ------------------------- |
| `text/`                                  | No (lint error)     | No (lint error)                      | Yes, required             |
| `speech/`                                | No (lint error)     | Yes, through `spawn`/`execFile` only | Yes, required             |
| `session/`                               | No (lint error)     | No                                   | Yes, required             |
| `commands/`, `ui/`, `reader/`, `config/` | Yes                 | No                                   | Integration tests         |

- `text/` is pure functions: string in, value out.
- `speech/` takes plain values (`text`, `voice`, `rate`) and knows nothing about VS Code. Platform code sits behind one interface, so callers never check `process.platform`.
- A new folder needs a row in this table first.

## TypeScript

- `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and the other flags in `tsconfig.json`. Never loosen them to make code compile.
- No `any`. Use `unknown` and narrow it. No non-null `!` outside tests.
- Named exports only. No default exports, no `enum` (use a union of string literals), no namespaces.
- `import type` for anything used only as a type.
- Every exported function has an explicit return type.
- Every promise is awaited, returned, or passed to a handler that reports its error.
- `switch` over a union covers every member.

## Naming

| Thing                      | Style                  | Example                      |
| -------------------------- | ---------------------- | ---------------------------- |
| Files and folders          | kebab-case             | `src/speech/mac-say.ts`      |
| Types, interfaces, classes | PascalCase             | `SpeechEngine`               |
| Functions, variables       | camelCase              | `splitSentences`             |
| Module constants           | UPPER_CASE             | `MAX_RATE`                   |
| Command ids                | `readAloud2Me.<verb>`  | `readAloud2Me.readSelection` |
| Setting keys               | `readAloud2Me.<name>`  | `readAloud2Me.voice`         |
| Context keys               | `readAloud2Me.<state>` | `readAloud2Me.isReading`     |

Every command has `"category": "Read Aloud 2 Me"`, so the palette shows `Read Aloud 2 Me: Read Selection`. A unit test checks command, setting and keybinding names.

## Files and functions

- One job per file. A file over 300 lines is a sign it holds two jobs (lint warns).
- Functions do one thing and are short enough to read without scrolling.
- Comments say why, not what. Every exported symbol has a one-line JSDoc.
- No dead code, no commented-out code, no TODOs without an issue link.

## VS Code extension rules

- **Activation:** nothing runs at load. Commands, keybindings and views activate the extension through `contributes` (VS Code 1.74+), so `activationEvents` stays empty unless a new trigger needs it. `activate()` returns fast.
- **Disposables:** everything that returns a `Disposable` goes into `context.subscriptions`, or into a class that disposes it.
- **Errors:** never swallowed. A failure the user should know about shows `vscode.window.showErrorMessage` with one plain sentence and, where it helps, a button such as "Pick Voice". Details go to the extension's single `LogOutputChannel` ("Read Aloud 2 Me"). No `console.log` in `src/` (lint error).
- **Settings:** read through `src/config/`, never with raw `getConfiguration` strings elsewhere. React to changes with `onDidChangeConfiguration`. Every setting has a default, a description, and a row in the README.
- **Context keys:** UI state that keybindings need (`readAloud2Me.isReading`) is set with `setContext` in one place.
- **Webviews:** a strict Content Security Policy with a nonce, `localResourceRoots` limited to `media/`, no remote scripts, styles or fonts. Messages between the webview and the extension are typed with a shared union.
- **Processes:** `spawn` or `execFile` with an argument list. Never a shell string; `exec` is a lint error. Text goes to `say` and PowerShell through stdin, never in the arguments. Each process is killed when reading stops and when the extension deactivates.
- **No network:** `fetch`, `http` and `https` are not used in `src/`.
- **Engine range:** `engines.vscode` stays at `^1.90.0` so Cursor, Windsurf and VSCodium can install it. `@types/vscode` matches that version, never newer.
- **Bundle:** esbuild bundles `src/extension.ts` to `dist/extension.js`. Runtime `dependencies` are rare; each one needs a reason in the pull request.

## Tests

- Every change to `text/` or `speech/` comes with unit tests next to the same path under `src/test/unit/`.
- `speech/` unit tests use a fake process runner; they never make sound.
- Integration tests cover command registration, settings and the reader panel opening.
- A bug fix starts with a failing test.

## Changelog and versions

- `CHANGELOG.md` follows Keep a Changelog. Every pull request that changes what users see adds one plain line under `## [Unreleased]`, in `Added`, `Changed`, `Fixed` or `Removed`.
- Lines are for users: what they can now do, not how the code changed.
- Versions follow semver. A release moves `Unreleased` into `## [x.y.z] - YYYY-MM-DD` and bumps `package.json` in the same commit, tagged `vx.y.z`.

## Git and pull requests

- Branches: `feature/<name>` or `fix/<name>`.
- Commit messages: short, imperative, lowercase. `add markdown cleaner`, not `Added Markdown cleaner.`
- One topic per pull request. `npm run verify` passes before review.
- Pull request descriptions list what changed for users and how it was tested, with checkboxes for anything left.

## Docs and copy

- User-facing text (README, setting descriptions, messages, command titles) is short, plain and calm. No em dashes.
- The README lists every command and setting (a unit test checks).
- Research and design notes go in `docs/`, never in code comments.
