# Architecture

How Read Aloud 2 Me fits together. Folder rules are in [AGENTS.md](../AGENTS.md); the reasons behind the big choices are in [plan.md](plan.md) and [research.md](research.md).

## The flow

```
 shortcut / menu / player button
            |
 commands/register-commands.ts     command id -> controller method
            |
 commands/reading-controller.ts    builds a ReadRequest, owns the session, updates the UI
   |   commands/read-request.ts      selection / cursor / whole file -> text/prepare.ts
   |   commands/preview-request.ts   Markdown preview: copy the selection, restore the clipboard
   |
 session/reading-session.ts        idle / reading / paused; next, previous, jump
            |
 speech/switching-engine.ts        online or computer voices, per the voiceSource setting
   |                         |
 speech/online/              speech/mac-say-engine.ts      (computer voices, macOS)
   Edge neural voices        speech/windows-sapi-engine.ts (computer voices, Windows)
```

Events flow back up. The engine reports each sentence start and word. The session turns them into session-wide indexes. The controller then updates:

- `ui/status-bar.ts`: "3 of 12", speed, voice.
- `ui/context-keys.ts`: `readAloud2Me.isReading` and `readAloud2Me.isPaused`, which drive `Esc` and the player buttons.
- `ui/highlighter.ts`: the sentence, the word and the already-read text in every visible editor of the document.
- `reader/reader-panel.ts`: the reader webview (`media/reader.js`, `media/reader.css`).

## Text to sentences

`text/prepare.ts` picks a cleaner by language: `text/markdown.ts` (parsed with `mdast-util-from-markdown`, GFM and front matter) or `text/plain.ts` for plain text and code. Skipped content is silent, never announced.

Each `Sentence` holds the exact text sent to the engine, plus `Piece`s that map spoken offsets back to document offsets (`text/offset-map.ts`). Word events are offsets into the sentence text, so the highlighter maps them through the pieces. If the document is edited mid-read, `session/offset-shift.ts` moves the offsets and drops sentences an edit touched.

## Speech

Every engine speaks a list of sentences in order and reports `onSentenceStart(index)` and `onWord({ sentence, start, length })`. User text reaches local tools on stdin only, never in a command line.

**Online voices** (`speech/online/`, the default):

- `edge-synthesizer.ts` downloads each sentence as MP3 with word timings from Microsoft Edge's neural voices, through `msedge-tts`. This is the only code that uses the network.
- `online-engine.ts` fetches up to three sentences ahead, plays each file, and fires word events from timers. It moves on as soon as the last word ends, skipping the service's trailing silence.
- Pause stops playback and remembers the position. Resume plays the rest of the same MP3, cut at a frame boundary (`mp3.ts`), with no new download.
- Players: `mac-afplay-player.ts` runs `afplay`. `windows-media-player.ts` asks the PowerShell host to play the file with Windows' media player.
- If the service can't be reached before anything plays, `switching-engine.ts` replays the run on the computer's voices and the user is told once.

**Computer voices** (offline):

- **macOS:** `say -i`, which prints each word as it is spoken. `say` takes about 1.5 s to start, so one process reads all remaining sentences, joined into one line. `say` can't pause, so pause stops it and resume restarts from the current word.
- **Windows:** one long-lived `powershell.exe -File resources/speech-host.ps1`, speaking JSON lines on stdin and stdout. Each sentence is a `SpeakAsync` prompt, so SAPI plays them back to back. Pause and resume are native. The same host plays online-voice audio.

## Tests

- `src/test/unit/`: plain Node (mocha). Fake processes, players and downloads: nothing makes sound or uses the network. On Windows, a smoke test also runs the real PowerShell host.
- `src/test/integration/`: inside VS Code (`@vscode/test-cli`): activation, commands, reader panel. `READ_ALOUD_E2E=1` adds tests that read aloud for real.
