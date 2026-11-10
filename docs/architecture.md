# Architecture

How Read Aloud 2 Me fits together. The rules each folder follows are in [AGENTS.md](../AGENTS.md); why the big choices were made is in [plan.md](plan.md) and [research.md](research.md).

## The flow

```
 shortcut / menu / player button
            |
   commands/register-commands.ts      command id -> controller method
            |
   commands/reading-controller.ts     builds a ReadRequest, owns the session, updates the UI
     |            |             |
     |   commands/read-request.ts     selection / cursor / whole file -> text/prepare.ts
     |   commands/preview-request.ts  Markdown preview: copy the selection, restore the clipboard
     |
   session/reading-session.ts         state machine: idle, reading, paused; next, previous, jump
            |
   speech/engine.ts                   SpeechEngine interface
     |                     |
 speech/mac-say-engine.ts   speech/windows-sapi-engine.ts
   `say -i -f -`              powershell.exe -File resources/speech-host.ps1
   one process per run        one long-lived process, JSON lines on stdin/stdout
```

Events flow back up: the engine reports sentence starts and words, the session turns them into session-wide indexes, and the controller updates:

- `ui/status-bar.ts`: "3 of 12", speed, voice.
- `ui/context-keys.ts`: `readAloud2Me.isReading` and `readAloud2Me.isPaused`, which drive Escape and the title-bar player buttons.
- `ui/highlighter.ts`: the sentence, the word and the read text in every visible editor of the document.
- `reader/reader-panel.ts`: the reader webview beside the editor (`media/reader.js`, `media/reader.css`).

## Text to sentences

`text/prepare.ts` is the entry point. It picks a cleaner by language:

- Markdown: `text/markdown.ts` parses with `mdast-util-from-markdown` (GFM and front matter) and walks the tree. Skipped content is silent, never announced.
- Plain text and code: `text/plain.ts`.

Each `Sentence` carries the exact text sent to the engine and a list of `Piece`s that map spoken offsets back to document offsets (`text/offset-map.ts`). Word events from the engine are offsets into the sentence text, so the highlighter maps them through the pieces. When the user edits the document mid-read, `session/offset-shift.ts` moves the offsets, and drops sentences an edit touched.

## Speech engines

Both engines speak a list of sentences in order and report `onSentenceStart(index)` and `onWord({ sentence, start, length })`.

- **macOS** joins the sentences into one line (line breaks reset `say`'s offsets) and runs `say -i`, which prints each word as it is spoken. `say` takes about 1.5 s to start, so one process reads the whole run. `say` can't pause, so pause stops it and resume starts again from the current word.
- **Windows** keeps one PowerShell process alive. Each sentence is its own `SpeakAsync` prompt, so SAPI plays them back to back. Pause and resume are native.

User text only ever reaches these tools on stdin, never in a command line.

## Tests

- `src/test/unit/`: plain Node (mocha). Text, session and speech layers, with fake processes; nothing makes sound.
- `src/test/integration/`: inside VS Code (`@vscode/test-cli`): activation, commands, reader panel.
