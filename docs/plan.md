# Read Aloud 2 Me: implementation plan

Status: **phases 0 to 7 implemented** on 2026-11-10. See §7 for what was verified and what was not.
Inputs: [brief.md](brief.md), [research.md](research.md), [prototype.html](prototype.html).

## 1. Decisions this plan makes

| #   | Decision                                                                                                                          | Why                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Speak from the extension host with OS tools: `say` on macOS, a persistent `powershell.exe` 5.1 running `System.Speech` on Windows | Offline, no webview, no native modules. Both give word events and some form of pause (research §2, §3)                                                                                                                |
| D2  | macOS speaks a **run** of sentences per `say -i` process, not one process per sentence                                            | `say` takes about 1.5 s to start. `say -i` reports each word's offset, so the session knows which sentence is playing. Only user actions (start, next, previous, resume, speed or voice change) pay the start-up cost |
| D3  | Windows keeps **one** PowerShell process alive per session and queues one `SpeakAsync` per sentence                               | PowerShell start-up is 0.3–1.2 s. SAPI queues prompts with no gap and has native `Pause()`/`Resume()`                                                                                                                 |
| D4  | Markdown is parsed with `mdast-util-from-markdown` + GFM + front matter, walked by our own code                                   | Gives exact source offsets for highlighting. Regex cleaners break on nesting; `strip-markdown` drops positions                                                                                                        |
| D5  | Sentences come from `Intl.Segmenter` plus an abbreviation-merge list                                                              | Built in, tested good on `e.g.`, `v1.2`, `index.ts`; the merge list fixes `Dr.`, `Mr.`                                                                                                                                |
| D6  | The "player" is native pieces: editor title buttons, status bar items, and the reader panel                                       | VS Code has no API to draw a widget over the editor (research summary). See open question Q1                                                                                                                          |
| D7  | The reader panel is a `WebviewPanel` opened beside the editor with `preserveFocus`                                                | Same feel as "Open Preview to the Side". Strict CSP, no network                                                                                                                                                       |
| D8  | `extensionKind: ["ui"]`, no `browser` entry, `engines.vscode: ^1.90.0`                                                            | Runs locally in remote setups. Covers Cursor (1.105) and other forks                                                                                                                                                  |
| D9  | TypeScript stays on 6.0                                                                                                           | TypeScript 7 is out, but typescript-eslint 8.72 supports only `<6.1`                                                                                                                                                  |
| D10 | Mid-sentence pause: Windows uses native `Pause()`. macOS kills `say` and resumes from the **current word**                        | `SIGSTOP` does not stop `say` audio (tested). Resuming from the word keeps the place; the cost is about 1.5 s before audio returns                                                                                    |
| D11 | No bundled binary in v1. A Swift `AVSpeechSynthesizer` helper is the planned v1.1 upgrade for macOS                               | The helper gives 40 ms gaps and true pause (prototyped), but needs signing, a universal build and platform packaging. See open question Q3                                                                            |

## 2. Architecture

### 2.1 Layers

Dependencies point down only. The ESLint config already enforces the pure layers.

```
src/
  extension.ts            activate/deactivate: builds objects, registers commands. No logic.
  commands/               one file per command group; thin glue from VS Code to the session
  platform/               everything that touches the vscode API
    config.ts             typed settings reader + change events
    contextKeys.ts        readAloud2Me.reading / .paused via setContext
    editorSource.ts       selection, cursor-to-end, whole file, Markdown preview copy route
    highlighter.ts        decoration types: current word, current sentence, already read
    statusBar.ts          speaker item + "3 of 12" + speed + voice
    offsetTracker.ts      shifts stored offsets when the document is edited mid-read
  reader/                 reader WebviewPanel (host side) + media/ (webview JS/CSS)
  session/                PURE. ReadingSession state machine, navigation, events
  speech/                 PURE (no vscode). Engine interface + macOS and Windows engines
    engine.ts             SpeechEngine / SpeechRun interfaces, Voice type, capabilities
    mac/sayEngine.ts      spawns `say -i -f -`, parses frames
    mac/sayFrameParser.ts pure parser for `say -i` output
    mac/voiceList.ts      parses `say -v '?'`
    windows/sapiEngine.ts JSON-lines client for the PowerShell host
    windows/protocol.ts   message types shared with the .ps1
    rate.ts               speed multiplier -> say wpm / SAPI rate
    createEngine.ts       picks the engine for process.platform
  text/                   PURE, no Node imports. Text -> sentences with source offsets
    types.ts              Piece, Sentence, SpeakableText
    markdown.ts           mdast walker with speaking rules
    plain.ts              plain text and code
    sentences.ts          Intl.Segmenter + abbreviation merge
    offsetMap.ts          spoken offset -> source offset
resources/
  windows/speechHost.ps1  the PowerShell speech host, run with -File
```

`session/` is added to the pure layers in `eslint.config.mjs`, so the state machine is unit-tested in plain Node with a fake engine.

### 2.2 Core types (sketch)

```ts
/** One stretch of spoken text and the source range it came from. */
interface Piece {
  spokenStart: number; // offset in Sentence.text
  spokenEnd: number;
  srcStart: number; // UTF-16 offset in the TextDocument
  srcEnd: number;
  kind: "verbatim" | "synthetic"; // verbatim maps 1:1; synthetic maps to the whole range
}

/** One sentence, exactly as it is sent to the speech engine. */
interface Sentence {
  text: string;
  srcStart: number;
  srcEnd: number;
  pieces: readonly Piece[];
}

/** What the speech engine can do on this platform. */
interface EngineCapabilities {
  pauseMidSentence: boolean;
  wordEvents: boolean;
}

interface SpeechEngine extends Disposable {
  readonly capabilities: EngineCapabilities;
  listVoices(): Promise<readonly Voice[]>;
  /** Speaks sentences in order from the first; events report the sentence index. */
  speak(sentences: readonly string[], options: SpeakOptions): SpeechRun;
}

interface SpeechRun {
  readonly onWord: Event<{ sentence: number; start: number; length: number }>;
  readonly onSentenceStart: Event<number>;
  readonly onEnd: Event<EndReason>; // "finished" | "cancelled" | { error }
  pause(): void;
  resume(): void;
  cancel(): void;
}
```

The engine never sees `vscode` types. `Event` and `Disposable` are small local types in `speech/`.

### 2.3 Reading session

States: `idle → starting → speaking ⇄ paused → idle`. Every user action is one method:
`start(text, from)`, `togglePause()`, `next()`, `previous()`, `jumpTo(i)`, `setVoice()`, `setSpeed()`, `stop()`.

- Next, previous, jump, voice and speed changes all cancel the run and start a new one at the target sentence.
- The session emits `stateChanged`, `sentenceChanged(i, total)` and `word(i, range)`. Status bar, highlighter, context keys and the reader panel only listen.
- Stop paths all go through `stop()`: shortcut, Escape, status bar click, editor closed, window closing (`deactivate`).

### 2.4 Commands, keys, settings

| Command id                       | Title                              | Default key                 |
| -------------------------------- | ---------------------------------- | --------------------------- |
| `readAloud2Me.toggle`            | Read Aloud 2 Me: Read Aloud / Stop | `cmd+'` / `ctrl+'`          |
| `readAloud2Me.stop`              | Stop                               | `escape` while reading only |
| `readAloud2Me.pauseResume`       | Pause / Resume                     | none                        |
| `readAloud2Me.next`, `.previous` | Next / Previous Sentence           | none (open question Q5)     |
| `readAloud2Me.pickVoice`         | Pick Voice                         | none                        |
| `readAloud2Me.setSpeed`          | Set Speed                          | none                        |
| `readAloud2Me.openReader`        | Open Reader to the Side            | none                        |

- Context menu: `editor/context` item "Read aloud" with `when: editorHasSelection`.
- Toggle `when`: `editorTextFocus || activeWebviewPanelId == 'markdown.preview' || readAloud2Me.reading`.
- Escape `when`: `readAloud2Me.reading && !suggestWidgetVisible && !findWidgetVisible && !inlineChatVisible && !inQuickOpen`.

| Setting                                | Type                                                                  | Default               |
| -------------------------------------- | --------------------------------------------------------------------- | --------------------- |
| `readAloud2Me.voice`                   | string, `scope: machine` (names differ per OS, so it should not sync) | `""` = system default |
| `readAloud2Me.speed`                   | number 0.5–2                                                          | 1                     |
| `readAloud2Me.markdown.skipCodeBlocks` | boolean                                                               | true                  |
| `readAloud2Me.noSelection`             | `"cursorToEnd"` \| `"wholeFile"`                                      | `"cursorToEnd"`       |
| `readAloud2Me.reader.openOnStart`      | boolean                                                               | false                 |
| `readAloud2Me.highlight.words`         | boolean                                                               | true                  |

## 3. Phases

Each phase ends with green `npm run verify`, updated docs and a short demo note. Each phase is one or more PRs on a `feature/` branch.

### Phase 0: foundation and spikes (1–2 days)

Goal: a repo that builds, lints and tests an empty extension, and answers to the risky questions.

- `git init`, `.gitignore`, `.vscodeignore`, `.prettierrc.json`, `.editorconfig`, `.mocharc.json`, `.vscode-test.mjs`, `.vscode/launch.json` and `tasks.json`, `LICENSE`.
- Bump `mocha` to 12; add `c8` for coverage and `ovsx`; set `engines.node` to `>=22.13` (ESLint 10 needs it). Add `session/` to the pure layers.
- Stub `src/extension.ts` with one command, one unit test and one integration test.
- CI: `.github/workflows/ci.yml`, matrix macOS + Windows + Ubuntu, `npm ci && npm run verify` (xvfb on Linux only).
- Spikes, each written up in `docs/spikes/`:
  1. macOS: `say -i` offsets with emoji and non-BMP characters (UTF-16 or code points?), and with an Enhanced or Premium voice installed.
  2. macOS: by ear, check that resume-from-word sounds natural and the speed map feels right at 0.5x and 2x.
  3. Windows: a 60-line `speechHost.ps1` prototype. Check `Pause()`, `Resume()`, `SpeakProgress`, async stdin and UTF-8 on Windows 11. Needs a Windows machine or VM.
  4. Remote: a UI extension reads selected text from an SSH or WSL file.

Exit: spike notes confirm D2, D3 and D10.

### Phase 1: text pipeline (2–3 days)

Goal: any text becomes `Sentence[]` with correct source offsets. Pure, fully unit-tested.

- `text/sentences.ts`: segment per block, merge after abbreviations, collapse whitespace.
- `text/markdown.ts`: the speaking rules in research §8, each in its own small function with a doc comment that names the rule. Rule of thumb: speak only what a listener wants to hear; skipped content is silent, never announced.
- `text/plain.ts`: blank line is a paragraph break. Code files: strip leading comment markers only.
- `text/offsetMap.ts`: binary search from spoken offset to source offset; snap outward to a word.
- Tests: a fixture per Markdown construct, golden-file style (`input.md` → expected sentences), plus offset round-trip tests. Coverage target 95% for `text/`.

### Phase 2: speech engines (3–4 days)

Goal: `SpeechEngine` works on both platforms, with a fake for tests.

- `speech/engine.ts` interfaces and `FakeEngine` (deterministic timers) for tests.
- macOS `sayEngine`: join sentences with single spaces on one line (newlines reset `say -i` offsets), send on stdin, set `TERM` in the child env, parse frames, map offsets to sentence index. Cancel with `SIGTERM`. Pause per D10: remember the current word, kill, and on resume speak from that word.
- macOS `voiceList`: parse `say -v '?'`; mark Enhanced/Premium by name.
- Windows `speechHost.ps1`: JSON lines on stdin and stdout, `Register-ObjectEvent` for events, async stdin read loop, UTF-8 without BOM, Constrained Language Mode check at start.
- Windows `sapiEngine`: spawns `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <ext>/resources/windows/speechHost.ps1`, `shell: false`. Restarts the host once if it dies.
- `rate.ts`: one function per platform, calibrated in Phase 0.
- Unit tests: frame parser, voice-list parser, protocol encoding, rate maps, engine against a fake child process. Integration smoke test per OS, skipped in CI when no audio device.

### Phase 3: read and stop (2–3 days) — first usable build

Goal: the brief's core loop. Select, `cmd+'`, hear it, `cmd+'` or Escape stops.

- `session/readingSession.ts` with the state machine and unit tests against `FakeEngine`.
- `platform/editorSource.ts`: selection; no selection → cursor to end or whole file per setting.
- Commands toggle, stop, context menu item, Pick Voice (QuickPick with OS voices, current one marked, preview on focus is out of scope), Set Speed.
- Status bar speaker item while reading; click stops.
- Context keys `readAloud2Me.reading`, `readAloud2Me.paused`.
- Errors: no voices, engine missing, Constrained Language Mode, voice not found → one clear notification with an action ("Pick Voice", "Open Settings"). No silent catches.
- Output channel "Read Aloud 2 Me" (`LogOutputChannel`) for debug logs; never logs the text itself.

### Phase 4: player controls and highlighting (3–4 days)

Goal: the brief's player and editor highlighting.

- Editor title buttons while reading: previous, pause/resume (icon swaps on `readAloud2Me.paused`), next, stop, open reader.
- Status bar: "3 of 12", speed (click → Set Speed), voice (click → Pick Voice).
- Changing speed or voice restarts the current sentence.
- Pause: mid-sentence where the engine supports it, else restart the sentence on resume.
- `platform/highlighter.ts`: three decoration types created once; current word, current sentence, read text dimmed with `opacity`. Reapplied on visible-editor changes. Cleared on stop.
- `platform/offsetTracker.ts`: shift offsets on edits before the reading point; stop if an edit lands in unread text.
- Reveal the current sentence with `revealRange(InCenterIfOutsideViewport)`.

### Phase 5: reader panel (3 days)

Goal: the side panel from the brief.

- `reader/readerPanel.ts`: one panel at a time, `ViewColumn.Beside`, `preserveFocus: true`, `retainContextWhenHidden: false` (state is re-sent on show).
- Webview code in `src/reader/media/` bundled by a second esbuild entry for the browser. Strict CSP with a nonce, `localResourceRoots` limited to `dist/reader`.
- Typed messages both ways, validated on receipt: `render`, `progress`, `fontSize` to the webview; `jumpTo`, `fontSize`, `ready` to the host.
- Theme colours from VS Code CSS variables. Current sentence lit, read sentences dimmed, click to read from there, A−/A+ stored in `globalState`.
- Opens from the editor title button, the command, or on every start when `reader.openOnStart` is on.
- Accessibility: sentences are buttons with `aria-current`, keyboard reachable, honours `prefers-reduced-motion`.

### Phase 6: Markdown preview (1–2 days)

Goal: the shortcut works when the Markdown preview has focus.

- Detect the preview tab (`TabInputWebview`, viewType `mainThreadWebview-markdown.preview`).
- With a selection: save clipboard, run `editor.action.clipboardCopyAction`, read, restore. Text from the preview is plain, so it is read with the plain-text rules and has no editor highlighting.
- Without a selection: read the source document found from the tab label.
- Later, not v1: a `previewScripts` script to light up sentences inside the preview.

### Phase 7: docs, packaging, release (2 days)

- README with a GIF, shortcuts, settings table, voice download steps for macOS and Windows, privacy statement, troubleshooting.
- `CHANGELOG.md` (Keep a Changelog), `CONTRIBUTING.md`, `docs/architecture.md` (the diagram in §2.1, kept current). Decisions D1–D11 are recorded in §1.
- Icon, gallery banner, categories `Accessibility` and `Other`.
- `release.yml`: on a `v*` tag, build one `.vsix`, publish to Open VSX and the Marketplace with `HaaLeo/publish-vscode-extension@v2`, attach the `.vsix` to a GitHub release. Tokens in repository secrets.
- Manual test pass: macOS and Windows, SSH remote, Cursor, VSCodium.

### Later

macOS Swift helper (v1.1), Linux (`spd-say`), OneCore voices on Windows through WinRT, in-preview highlighting, webview `speechSynthesis` fallback.

## 4. Coding standards

- **Latest stable tools, checked each phase** with `npm outdated`. Exceptions are written in research §11 with the reason (TypeScript 6, `@types/vscode` pinned to the engine).
- **Docs lookups:** check the current API in Context7 or the VS Code API reference before using any API. No copied snippets from old blog posts.
- **TypeScript:** the strict `tsconfig.json` as it stands. No `any`, no non-null assertions outside tests, string unions instead of enums, named exports only (already enforced).
- **Doc comments:** TSDoc on every exported symbol: one-line summary, then `@param`, `@returns`, `@throws` where useful, and `@example` for pure functions. Each file starts with a short comment that says what the module is for and what it must not do.
- **Errors:** typed error classes in `src/errors.ts` (`EngineUnavailableError`, `VoiceNotFoundError`, …). Every `catch` logs or surfaces; no empty catches. User-facing messages say what to do next.
- **Processes:** `spawn`/`execFile` with an argument list and `shell: false` only. User text goes on stdin, never into arguments.
- **Privacy:** no network calls (lint rule already bans `fetch`). Logs never contain document text. No telemetry.
- **Disposal:** everything with a lifetime is a `Disposable` pushed to `context.subscriptions`. Child processes are killed in `deactivate`.
- **Files:** under 300 lines (lint warning). One concept per file.
- **Tests:** unit tests next to the layer they test in `src/test/unit/<layer>/`. Pure layers use a fake engine and fake clock. Integration tests cover command wiring, context keys and decorations. Coverage gates: `text/` 95%, `session/` 90%, overall 80%.
- **Git:** `feature/…` and `fix/…` branches, short lowercase imperative commits, PRs through `gh` with a checkbox TODO list.

## 5. Risks

| Risk                                             | Effect                           | Mitigation                                                                                             |
| ------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| macOS `say` cannot pause                         | Resume lags about 1.5 s          | Resume from the current word. Swift helper in v1.1 removes the lag                                     |
| 1.5 s `say` start-up                             | Lag on start, next, previous     | One process per run, so only user actions pay it. Show "starting" state at once                        |
| `say -i` output format changes in a macOS update | No word highlighting             | Parser is pure and tested on fixtures. On parse failure, keep speaking and highlight the sentence only |
| PowerShell blocked by policy (CLM, AppLocker)    | No speech on locked-down Windows | Detect at start, explain clearly. Webview fallback is listed under Later                               |
| Windows tested only in a VM                      | Bugs found late                  | Phase 0 spike plus CI on `windows-latest`                                                              |
| Default voices sound robotic                     | Poor first impression            | README and the Pick Voice list explain how to download Enhanced/Premium voices                         |
| `cmd+'` clashes in a fork or on a non-US layout  | Shortcut does nothing            | Document rebinding. Consider `[Quote]` scan-code binding                                               |

## 6. Resolved questions

Decided 2026-11-10, listener first:

1. Player: editor title buttons + status bar + reader panel. No CodeLens.
2. Mid-sentence pause and word highlight stay in v1.
3. macOS v1 uses `say` only. Swift helper is v1.1.
4. No Windows machine: Windows covered by unit tests and CI.
5. No default keys for previous, next, pause.
6. Markdown preview uses the clipboard copy route, clipboard restored.
7. Code blocks, images, task boxes, list numbers: silent. Bare URLs: domain only. Tables: "Header: cell".
8. Linux out of v1. Name kept.

## 7. Implementation status

All phases are built. `npm run verify` passes: format, types, lint, 234 unit tests, integration tests in VS Code 1.145.2. Pure-layer line coverage is 98.6%.

| Phase                     | State | Verified how                                                                                                                                          |
| ------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Foundation              | Done  | CI matrix (macOS, Windows, Linux), `.c8rc.json`, release workflow                                                                                     |
| 1 Text pipeline           | Done  | Unit tests, a realistic Markdown sample read by ear                                                                                                   |
| 2 Speech engines          | Done  | macOS: real `say` runs, pause and resume from the word. Windows: fake-host unit tests, plus a real-host smoke test that runs on the CI Windows runner |
| 3 Read and stop           | Done  | Real-speech integration test (`READ_ALOUD_E2E=1`)                                                                                                     |
| 4 Player and highlighting | Done  | Real-speech integration test for pause, resume, next, stop                                                                                            |
| 5 Reader panel            | Done  | Integration tests                                                                                                                                     |
| 6 Markdown preview        | Done  | Not tested automatically: needs a human to select text in a preview                                                                                   |
| 7 Docs and release        | Done  | `.vsix` builds (75 KB, 11 files). Not published: needs registry tokens                                                                                |

Changes from the plan made during the build:

- Code files: each code line is its own sentence and comment lines read as prose, so a comment never runs into the code under it.
- `say` silently uses the default voice when a voice is missing, so the controller checks the voice against the installed list and says so once.
- No CodeLens player. The player is title-bar buttons, the status bar (place, speed, voice; the tooltip shows the sentence) and the reader panel.

Not verified, needs a person:

- Windows speech by ear: pause, resume and word events from the real PowerShell host, and the rate mapping.
- Markdown preview selection reading.
- SSH or WSL remote windows, and forks (Cursor, VSCodium).
- Personal Voice on macOS.

## 8. Change: online voices (2026-11-10)

The user chose natural voices over the offline-only promise. Decision D12: Microsoft Edge's online neural voices are the default source on both platforms, through `msedge-tts`, with the computer's voices as an offline setting and automatic fallback. The endpoint is not an official public API and may change; updating `msedge-tts` is the fix when it does.
