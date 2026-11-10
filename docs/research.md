# Read Aloud 2 Me: research findings

Date: 2026-11-10. Answers the research questions in [brief.md](brief.md) §6.
Confidence: **H** checked in docs, source or a local test. **M** strong inference. **U** unverified, needs a spike.
Local tests ran on macOS 26.5.1, Node 22.17.0.

## Summary

- **Speak from the extension host with OS tools (brief option A).** Both platforms give word events this way, so word highlighting needs no webview.
  - macOS: `say -i` streams each word as it is spoken, with its character offset (tested). `say` cannot pause; pause kills it and resume restarts from the current word.
  - Windows: one long-running `powershell.exe` 5.1 with `System.Speech` has `Pause()`, `Resume()` and per-word `SpeakProgress` events.
- **Do not spawn one process per sentence on macOS.** `say` takes about 1.5 s from spawn to first word (tested). Speak a run of sentences per process and track the sentence from word offsets.
- **Markdown:** parse with `mdast-util-from-markdown` plus the GFM and front-matter extensions, and walk the tree ourselves. Every node keeps source offsets. `strip-markdown` throws them away (tested).
- **Sentences:** `Intl.Segmenter` plus an abbreviation-merge pass (tested).
- **The "player at the top of the editor" cannot be drawn as one widget.** Extensions cannot overlay UI on the editor. The nearest native pieces are editor title buttons, status bar items and CodeLens.
- **Gap in the market:** no maintained, offline, OS-voice extension has a default shortcut, Escape to stop, good Markdown cleaning and highlighting.

## 1. Existing extensions (Q1) — H

| Extension                           | Installs         | Updated | Engine                       | Offline | Gap vs ours                                             |
| ----------------------------------- | ---------------- | ------- | ---------------------------- | ------- | ------------------------------------------------------- |
| ms-vscode.vscode-speech             | 1.47M            | 2026-08 | bundled Azure model          | yes     | Reads **chat replies only**, not editor text            |
| bierner.speech                      | 25k              | 2024-01 | say.js                       | yes     | Stale. No Markdown cleaning, no default shortcut        |
| azu.read-aloud-text                 | 10.6k            | 2018-11 | say.js + textlint            | yes     | Dead. Had highlighting                                  |
| RobinReiche.markdown-read-aloud     | 2.8k + 4.8k OVSX | 2026-10 | Edge neural endpoint         | **no**  | Cloud                                                   |
| fabioc-aloha.ai-voice-reader        | 371              | 2026-08 | say / System.Speech / espeak | yes     | Closest. No shortcut, no highlighting, paragraph chunks |
| Larsini.offline-markdown-read-aloud | 608              | 2026-07 | bundled Piper models         | yes     | Large download, not OS voices                           |
| jshwek.eloquent, dorofino.polyvoice | ~300 each        | 2026    | mostly cloud, OS fallback    | partly  | Cloud first                                             |

## 2. macOS voices (Q2, Q8)

Findings:

- **Enhanced/Premium voices** appear in `say` and `AVSpeechSynthesizer` once downloaded, named like "Ava (Premium)". — M (none installed on the test Mac)
- **Download path:** System Settings > Accessibility > Spoken Content > System voice > Manage Voices. macOS 26 reportedly renames "Spoken Content" to "Read & Speak". — M
- **Siri voices are not reachable.** `say -v '?'` and `AVSpeechSynthesisVoice.speechVoices()` both omit them, even when installed (tested). — H
- **Personal Voice** needs a TCC grant for the responsible app (probably Code.app). Not testable here. — U
- **Default rate** is about 175 wpm. Low rates are clamped on modern voices, so 0.5x sounds closer to 0.8x. Map speed as `-r round(175 * m)`. — M (tested on Samantha)
- **`SIGSTOP` does not pause the audio.** Playback runs in a system speech service, not in the `say` process. Tested by watching the output device. — H
- **`SIGTERM` stops audio at once** (under 50 ms). — H
- **`say -i` needs `TERM` set** in the child environment, or it fails with "TERM environment variable not set". — H
- **A small Swift helper with `AVSpeechSynthesizer`** was prototyped: about 40 ms between sentences, true mid-sentence pause, exact word ranges, and voice quality tiers. It means shipping a signed universal binary in the VSIX. Marketplace extensions that ship unsigned binaries run without a quarantine flag. — H (tested), packaging M

Local tests — H:

- `say -v '?'` lists 180 voices here. Lines look like `Eddy (English (US))   en_US    # Hello! …`. Names contain spaces and parentheses, so parse with `^(.+?)\s{2,}([a-z]{2,3}_[A-Za-z0-9]+)\s+#`.
- **Spawn to first word: about 1.5 s**, steady across warm runs. A short "Hi." takes 1.8 s end to end. One process per sentence would leave a gap of over a second between sentences.
- **`say -i` (interactive) works without a terminal.** It prints frames separated by `\r`, each the full text with the current word wrapped in `ESC[7m … ESC(B ESC[m`. The prefix length before `ESC[7m` is the word's character offset into the text. Events arrive in real time, one per word, with correct offsets for `3.5`, `o'clock:`, `index.ts`, `e.g.`, `Dr.` and `Smith’s`.
- With text on stdin (`-f -`), offsets restart at each newline. Send each run as a single line.
- JXA (`osascript -l JavaScript`) with `ObjC.registerSubclass` **hung** even for a trivial class. The stack points at the command sandbox blocking executable memory, not macOS. Not retested outside it, so a JXA `AVSpeechSynthesizer` host is unverified.
- Rendering to a file (`say -o`) took 1.3 s for one sentence, so pre-rendering does not remove the start-up cost.

## 3. Windows voices (Q3, Q8)

- **System.Speech (SAPI 5)** sees desktop voices only: David and Zira on en-US. — H
  - Works in Windows PowerShell 5.1, which still ships on all Windows 10/11 through 25H2. PowerShell 7.2+ also works but is not installed by default. — H
  - `SpeakAsync`, `Pause()`, `Resume()`, `SpeakAsyncCancelAll()`, `SpeakProgress` (`CharacterPosition`, `CharacterCount`) and `SpeakCompleted` exist. — H (API). No published long-running stdin/stdout example. — U
- **OneCore voices** (Windows.Media.SpeechSynthesis) load from 5.1 through `ContentType=WindowsRuntime` plus the `AsTask` reflection trick. Word-boundary metadata is available. Playback through `SoundPlayer` has no pause. Not available in pwsh 7 without extra NuGet DLLs. — H/M
- **Narrator natural voices:** no public offline API for third parties. Community adapters decrypt system files; do not use. — M
- **Start-up:** `powershell.exe -NoProfile` takes 0.3–1.2 s. Use one persistent process per session. — M
- **Policy:** Constrained Language Mode (AppLocker/WDAC) blocks every PowerShell speech route; detect it and show a clear error. Avoid `-EncodedCommand` (an EDR red flag). Run a bundled `.ps1` with `-File`, and send text only as JSON on stdin. — H
- **Rate:** SAPI `Rate` is -10..10, logarithmic. Start with `round(10 * ln(m) / ln(3))` and calibrate on David/Zira. — M

## 4. Webview speechSynthesis (Q4) — M/U

- Electron lists fewer voices than Chrome. On Windows it shows SAPI voices only. Old Electron issues report empty lists until `voiceschanged`. — H
- Premium/Enhanced macOS voices in Electron's list: not confirmed. — U
- A webview cannot be created hidden. A panel always opens a tab. Speech dies when a panel is hidden unless `retainContextWhenHidden` is set. — H
- Verdict: not the primary engine. The reader panel may add it later only if the OS route fails.

## 5. Remote (Q5) — H/M

- `"extensionKind": ["ui"]` runs the extension on the local machine for SSH, WSL and Dev Containers. Open documents are synced to every extension host, so `document.getText()` works on remote files. — M, confirm by hand.
- Codespaces in the browser and vscode.dev have no local Node host. Ship no `browser` entry, so the extension simply does not load there. — H

## 6. Forks and Open VSX (Q6) — H

| Fork                 | Registry           | VS Code base       |
| -------------------- | ------------------ | ------------------ |
| Cursor               | Open VSX via proxy | 1.105              |
| Windsurf             | Open VSX           | 1.126              |
| VSCodium             | Open VSX           | 1.143              |
| Positron, Kiro, Trae | Open VSX           | 1.143 / unverified |

- Keep `engines.vscode` at `^1.90.0` (below Cursor's 1.105). Keep `@types/vscode` pinned to the same minor; vsce rejects a newer types version.
- The `cilladev` namespace already exists and is verified on Open VSX.
- Publish both registries from one `.vsix` with `HaaLeo/publish-vscode-extension@v2` (Open VSX first, then the Marketplace).

## 7. Shortcut (Q7) — H/M

- `cmd+'` / `ctrl+'` is unbound in VS Code 1.144 core defaults. Built-in extension and fork bindings are not fully ruled out. — M
- On non-US layouts `'` moves. VS Code accepts the scan code `[Quote]` for a fixed physical key.
- Escape has 81 default rules. Bind it only with a context key that is true while reading, and exclude the suggest widget, find widget, inline chat and quick open.
- Webviews forward unhandled key presses to the workbench, so the shortcuts also work from the reader panel and the Markdown preview. — H

## 8. Markdown to speech (Q9) — H (tested)

- `mdast-util-from-markdown` 2.1 + `micromark-extension-gfm` + `mdast-util-gfm` + front matter: ESM-only, bundles to CJS with esbuild cleanly, about 121 KB minified (38 KB gzip).
- Every node has `position.start.offset` / `end.offset` as UTF-16 indexes, the same unit as `document.offsetAt`.
- A text node's value can differ from its source slice (escapes, entities). Align character by character, or fall back to the whole node range.
- Speaking rules (listener first: never announce what is skipped): headings as their own sentence; drop emphasis marks; link label only; bare URL read as its domain only; images, HTML, front matter, footnote references and fenced code skipped silently; table one sentence per row as "Header: cell"; list items as sentences with markers, numbers and task boxes silent.
- `Intl.Segmenter` handles `e.g.`, `v1.2`, `index.ts`, `U.S.`. It breaks wrongly after `Dr.`, `Mr.`, `Prof.`, `Fig.`; fix with a merge list. Never segment across blocks.

## 9. Markdown preview (Q10) — H (source)

- **previewScripts** run inside the preview but get no message channel back to the extension (`acquireVsCodeApi()` is already taken). They can read the selection and `data-line` attributes. Good for a later in-preview highlight, not for v1.
- **Copy route works:** `editor.action.clipboardCopyAction` copies the preview's selection when the preview has focus. Save and restore the clipboard around it.
- **Detecting the preview:** the active tab input is a `TabInputWebview` with `viewType` `mainThreadWebview-markdown.preview`. It exposes no source URI; match by the tab label.
- Recommendation: copy route for the selection; with no selection, read the source file.

## 10. Name (Q11) — H/M

- `read-aloud-2-me` is free on both registries. The closest name is `ofirski.read2me` ("READ2ME").
- No registered "READ ALOUD" mark for TTS software was found; it is a descriptive phrase used by Edge and Chrome extensions. Avoid Microsoft branding. Not legal advice.

## 11. Toolchain (checked with `npm view`)

| Package                                                  | In package.json | Latest        | Decision                                                     |
| -------------------------------------------------------- | --------------- | ------------- | ------------------------------------------------------------ |
| typescript                                               | ~6.0.3          | 7.0.2         | **Stay on 6.0.** typescript-eslint 8.72 supports `<6.1` only |
| mocha                                                    | ^11.7.6         | 12.0.3        | Move to 12                                                   |
| @types/vscode                                            | ~1.90.0         | 1.145.0       | Keep pinned to `engines.vscode`                              |
| @types/node                                              | ^22             | 26.x          | Keep 22 to match the extension host's Node                   |
| eslint, esbuild, vsce, test-cli, test-electron, prettier | current         | same          | Keep                                                         |
| ovsx, c8                                                 | missing         | 1.4.0, 12.0.0 | Add                                                          |
