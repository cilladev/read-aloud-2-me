# Read Aloud 2 Me

Select text in VS Code, press a shortcut, and hear it in your computer's own voice.

Works offline. Your text never leaves your computer.

## Features

- **One shortcut.** Press `Cmd+'` on Mac or `Ctrl+'` on Windows to read. Press it again, or `Esc`, to stop.
- **Right-click** selected text and choose **Read Aloud**.
- **Markdown reads like prose.** No `#` signs, stars, link addresses or table pipes. Code blocks, images and front matter are skipped silently. Tables are read row by row, each cell with its header.
- **Any file.** Plain text is read as is. In code files, comment markers are left out.
- **Nothing selected?** Reading starts at the sentence under the cursor and goes to the end of the file. A setting reads the whole file instead.
- **One sentence at a time.** Go back, skip ahead, pause and resume from the player buttons in the editor title bar while reading.
- **Highlighting.** The sentence being read is marked in the editor, with the current word, and text already read is dimmed.
- **Reader panel.** **Open Reader to the Side** shows the text as clean sentences beside your code. The current sentence is lit, sentences already read are dimmed, and clicking a sentence reads from there. Text size can be made larger or smaller.
- **Status bar.** While reading, the status bar shows the place ("3 of 12"), the speed and the voice. Click the place to stop, the speed or voice to change them.
- **Markdown preview.** Select text in the preview and press the shortcut. With nothing selected, the preview's source file is read.
- **Your computer's voices only.** macOS voices through `say`, Windows voices through PowerShell. Nothing is downloaded.
- **Remote windows.** In SSH, WSL and container windows the extension still runs on your own machine, where the speakers are.

## Commands

<!-- Every command in package.json is listed here. A test checks. -->

| Command                                  | What it does                                                          |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Read Aloud 2 Me: Read Aloud or Stop      | Reads the selection, or stops if already reading. `Cmd+'` / `Ctrl+'`  |
| Read Aloud 2 Me: Read Aloud              | Reads the selection, or from the cursor. Also in the right-click menu |
| Read Aloud 2 Me: Stop Reading            | Stops. `Esc` while reading                                            |
| Read Aloud 2 Me: Pause or Resume         | Pauses mid-sentence, or carries on                                    |
| Read Aloud 2 Me: Pause                   | Pauses mid-sentence                                                   |
| Read Aloud 2 Me: Resume                  | Carries on after a pause                                              |
| Read Aloud 2 Me: Previous Sentence       | Goes back one sentence                                                |
| Read Aloud 2 Me: Next Sentence           | Skips to the next sentence                                            |
| Read Aloud 2 Me: Pick Voice              | Lists the voices on this computer so you can choose one               |
| Read Aloud 2 Me: Set Speed               | Chooses a speed from half to twice as fast                            |
| Read Aloud 2 Me: Open Reader to the Side | Opens the reader panel beside the editor                              |

Change any shortcut in **Keyboard Shortcuts** (`Cmd+K Cmd+S`). Search for "Read Aloud 2 Me".

## Settings

<!-- Every setting in package.json is listed here. A test checks. -->

| Setting                                | Default           | What it does                                                                                       |
| -------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `readAloud2Me.voice`                   | empty             | The voice to read with. Empty means your computer's default voice                                  |
| `readAloud2Me.speed`                   | `1`               | Reading speed, from `0.5` to `2`                                                                   |
| `readAloud2Me.markdown.skipCodeBlocks` | `true`            | Leave out code blocks in Markdown                                                                  |
| `readAloud2Me.withoutSelection`        | `cursorToEnd`     | With nothing selected: read from the cursor (`cursorToEnd`) or the whole file (`wholeFile`)        |
| `readAloud2Me.reader.openOnStart`      | `false`           | Open the reader panel each time reading starts                                                     |
| `readAloud2Me.player.show`             | `true`            | Show the player buttons in the editor title bar while reading                                      |
| `readAloud2Me.highlight`               | `wordAndSentence` | Mark the word and sentence (`wordAndSentence`), the sentence only (`sentence`), or nothing (`off`) |

The voice setting stays on this computer and is not synced, because Mac and Windows voices have different names.

## Better voices

The voices that come with the computer can sound flat. Both systems offer better ones for free.

**macOS:** the most natural voices are Siri's. Open **System Settings**, then **Accessibility**, then **Read & Speak** (called **Spoken Content** before macOS 26). Set **System voice** to a **Siri** voice. Then run **Read Aloud 2 Me: Pick Voice** and choose **System voice**: Siri voices can only be used this way, not picked by name. Enhanced and Premium voices, such as "Ava (Premium)", also sound good; once downloaded they appear in **Pick Voice**, best first.

**Windows:** open **Settings**, then **Time & language**, then **Speech**, and add voices under **Manage voices**. Read Aloud 2 Me can use the voices Windows offers to desktop apps (for example Microsoft David and Zira). The newer Narrator "natural" voices are not open to other apps.

## Privacy

Read Aloud 2 Me makes no network calls and collects nothing. Text goes from VS Code to your computer's own speech tool and nowhere else.

## Troubleshooting

- **Nothing happens on `Cmd+'`.** Another extension may use the same key, or your keyboard layout may put `'` elsewhere. Open **Keyboard Shortcuts** and bind **Read Aloud 2 Me: Read Aloud or Stop** to a key you like.
- **There is a short wait before speech starts.** The macOS speech tool takes about a second to start. Pause, next and previous on macOS have the same wait.
- **Windows: "security policy blocks PowerShell".** Your organisation limits PowerShell, so the extension can't reach the voices. Ask your IT team.
- **Details.** Open the **Output** panel and choose **Read Aloud 2 Me**. The log never contains your text.

## Supported editors

VS Code 1.90 or later, on macOS and Windows. It also works in editors built on VS Code, such as Cursor, Windsurf and VSCodium. Linux is not supported yet. It does not run in the browser (vscode.dev or Codespaces in a browser tab).

## Install from source

You need [Node.js](https://nodejs.org) 22 or later and the editor's command line (`code`).

macOS or Linux:

```sh
./install.sh
```

Windows (PowerShell):

```powershell
.\install.ps1
```

For a fork, name its command: `./install.sh cursor`. Then reload the editor window.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). How the code fits together is in [docs/architecture.md](docs/architecture.md).

## License

[MIT](LICENSE)
