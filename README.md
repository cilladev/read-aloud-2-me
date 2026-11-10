# Read Aloud 2 Me

Select text in VS Code, press a shortcut, and hear it read in a natural voice.

## Quick start

1. Select some text in any file.
2. Press `Cmd+'` on Mac or `Ctrl+'` on Windows. You can also right-click and choose **Read Aloud**.
3. Press the shortcut again, or `Esc`, to stop.

With nothing selected, reading starts at the cursor and goes to the end of the file.

## What it does

- **Natural voices.** Microsoft Edge's online neural voices by default, on Mac and Windows. Your computer's own voices are an offline option. If the online voices can't be reached, the computer's voice reads instead.
- **Markdown reads like prose.** No `#`, stars, link addresses or table pipes. Code blocks, images and front matter are skipped silently. Table rows are read with their headers.
- **Any file.** Plain text is read as is. In code, comment markers are left out.
- **Follow along.** The sentence being read is marked in the editor, the current word stands out, and text already read is dimmed.
- **Player.** While reading, the editor title bar has previous, pause, next, stop and reader buttons. The status bar shows the place ("3 of 12"), speed and voice; click them to stop or change.
- **Reader panel.** **Open Reader to the Side** shows clean sentences beside your code. Click a sentence to read from there. Text size can be changed.
- **Markdown preview.** Select text in the preview and press the shortcut.
- **Remote windows.** In SSH, WSL and container windows it runs on your own machine, where the speakers are.

## Voices

Run **Read Aloud 2 Me: Pick Voice**. It lists two groups:

- **Online voices**, the default. They sound the most natural. Your language comes first; "multilingual" voices such as Ava and Andrew handle many languages.
- **This computer's voices**, which work offline. On a Mac the best are Siri's: set a Siri voice as **System voice** in **System Settings > Accessibility > Read & Speak**, then choose **System voice** in the list. On Windows, add voices in **Settings > Time & language > Speech**.

## Privacy

- **Online voices:** the sentences being read are sent to Microsoft's speech service, the same way Edge's "Read aloud" works. Nothing else is sent.
- **This computer's voices:** nothing leaves your computer. Set **Voice Source** to `computer` to stay offline.

There is no telemetry.

## Commands

<!-- Every command in package.json is listed here. A test checks. -->

| Command                                  | What it does                                                    |
| ---------------------------------------- | --------------------------------------------------------------- |
| Read Aloud 2 Me: Read Aloud or Stop      | Reads, or stops if reading. `Cmd+'` / `Ctrl+'`                  |
| Read Aloud 2 Me: Read Aloud              | Reads the selection or from the cursor. In the right-click menu |
| Read Aloud 2 Me: Stop Reading            | Stops. `Esc` while reading                                      |
| Read Aloud 2 Me: Pause or Resume         | Pauses mid-sentence, or carries on                              |
| Read Aloud 2 Me: Pause                   | Pauses mid-sentence                                             |
| Read Aloud 2 Me: Resume                  | Carries on after a pause                                        |
| Read Aloud 2 Me: Previous Sentence       | Goes back one sentence                                          |
| Read Aloud 2 Me: Next Sentence           | Skips to the next sentence                                      |
| Read Aloud 2 Me: Pick Voice              | Chooses an online or computer voice                             |
| Read Aloud 2 Me: Set Speed               | Chooses a speed from half to twice as fast                      |
| Read Aloud 2 Me: Open Reader to the Side | Opens the reader panel beside the editor                        |

To change a shortcut, open **Keyboard Shortcuts** and search for "Read Aloud 2 Me".

## Settings

<!-- Every setting in package.json is listed here. A test checks. -->

| Setting                                | Default                       | What it does                                                        |
| -------------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `readAloud2Me.voiceSource`             | `online`                      | `online` (natural, needs internet) or `computer` (offline)          |
| `readAloud2Me.onlineVoice`             | `en-US-AvaMultilingualNeural` | The online voice                                                    |
| `readAloud2Me.voice`                   | empty                         | The computer voice. Empty means your system voice. Not synced       |
| `readAloud2Me.speed`                   | `1`                           | From `0.5` to `2`                                                   |
| `readAloud2Me.markdown.skipCodeBlocks` | `true`                        | Leave out code blocks in Markdown                                   |
| `readAloud2Me.withoutSelection`        | `cursorToEnd`                 | With nothing selected: from the cursor, or `wholeFile`              |
| `readAloud2Me.reader.openOnStart`      | `false`                       | Open the reader panel each time reading starts                      |
| `readAloud2Me.player.show`             | `true`                        | Show the player buttons in the editor title bar                     |
| `readAloud2Me.highlight`               | `wordAndSentence`             | Mark the word and sentence, the `sentence` only, or nothing (`off`) |

## Troubleshooting

- **The shortcut does nothing.** Another extension may use it. Open **Keyboard Shortcuts**, find **Read Aloud 2 Me: Read Aloud or Stop**, and record a key you like. Right-click **Read Aloud** always works.
- **Online voices don't play.** Check your connection, or a firewall blocking `speech.platform.bing.com`. The computer's voice reads meanwhile.
- **A short wait before speech starts.** The first online sentence takes a second or two to download; later ones are fetched ahead.
- **Windows: "security policy blocks PowerShell".** Your organisation limits PowerShell, which the extension needs to play sound. Ask your IT team.
- **More detail.** Open the **Output** panel and choose **Read Aloud 2 Me**. The log never contains your text.

## Requirements

VS Code 1.90 or later on macOS or Windows. Also works in Cursor, Windsurf and VSCodium. Linux and browser-based VS Code are not supported yet.

## Install from source

You need [Node.js](https://nodejs.org) 22 or later.

```sh
npm ci
npm run vsix
code --install-extension read-aloud-2-me.vsix
```

Or run `./install.sh` (macOS) or `.\install.ps1` (Windows), which do the same. For a fork, pass its command, for example `./install.sh cursor`. Then reload the editor window.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). How the code fits together is in [docs/architecture.md](docs/architecture.md).

## License

[MIT](LICENSE)
