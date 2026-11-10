# Read Aloud 2 Me: brief

## 1. What it is

A VS Code extension that reads selected text aloud using the voices already installed on the computer. No cloud, no accounts, no network calls.

## 2. Core use

The user highlights text in any open file, presses a keyboard shortcut, and hears it spoken in the computer's own voice. Pressing the same shortcut again, or Escape, stops playback. Markdown files are the main case: symbols and formatting are cleaned before speaking so the output sounds natural.

## 3. Must have (v1)

- One two-key shortcut to start and stop: `Cmd+'` on Mac, `Ctrl+'` on Windows. One hand, thumb and little finger, next to Enter. People can change it in VS Code's Keyboard Shortcuts.
- Right-click context menu item "Read aloud" when text is selected.
- Works in any file type. For Markdown, a cleaner strips heading hashes, emphasis marks (`*`, `_`, `~`), link URLs, image syntax, table pipes and alignment rows before speaking. Fenced code blocks are skipped by default (controlled by a setting).
- Uses only voices already installed on the computer. Fully offline. Mac and Windows.
- Settings: voice name, speech speed. A command palette entry "Read Aloud 2 Me: Pick Voice" that lists installed voices and lets the user choose.
- Text is read one sentence at a time. A small player at the top of the editor shows the sentence being read and "3 of 12", with previous sentence, next sentence, pause, stop, speed and voice. Changing speed or voice restarts the current sentence with the new one.
- Pause stops at the current sentence; resume starts that sentence again.
- A reader panel opens to the side, like Markdown's "Open Preview to the Side": a webview in the editor group beside the code. It works for any file, because the extension draws its own text there. It shows the selection as clean text, with the sentence being read lit up and the ones already read dimmed. Clicking a sentence reads from there. Text size can be made larger or smaller. It opens from the player or a command, and a setting opens it each time reading starts.
- A status bar item appears while text is being read, showing a speaker icon. Clicking it stops playback.
- Pause and resume mid-sentence.
- Highlight each word in the editor as it is read.
- When nothing is selected, read from the cursor position to the end of the file, or the whole file.

## Later

- Linux support.

## 5. Two ways to speak

|                | A. Command line                                                 | B. Hidden webview (speechSynthesis)              |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| Mac            | `say -v <voice> -r <speed>`                                     | Browser Speech API inside a VS Code webview      |
| Windows        | PowerShell with `System.Speech.Synthesis` (SAPI)                | Same browser Speech API                          |
| Voice list     | Mac: `say -v '?'`. Windows: enumerate SAPI voices in PowerShell | `speechSynthesis.getVoices()` in the webview     |
| Stop           | Kill the child process                                          | `speechSynthesis.cancel()`                       |
| Pause / resume | Not available                                                   | Available                                        |
| Word events    | Not available                                                   | `onboundary` event gives word position           |
| Complexity     | Low. No webview, no window.                                     | Needs a webview kept alive while speaking        |
| Voice coverage | OS-level voices directly                                        | Voice list may differ by OS and Electron version |

Current lean: **A (command line) for v1.** Simpler, no webview overhead. Each sentence is its own `say` or PowerShell run, so skipping, sentence-level pause and long selections all come from starting and ending one process per sentence. Mid-sentence pause and word highlighting wait for later.

The prototype (`prototype.html`) uses the browser's speech API with the local voices only, to try the feel before building.

## 6. Research questions

1. Which existing extensions on the VS Code Marketplace and Open VSX already read text aloud? Are they maintained? How do they handle Markdown cleaning, voice selection, and keyboard shortcuts? What gap remains that this extension would fill?
2. On Mac, can the `say` command use high-quality voices (Enhanced, Premium, Personal Voice, Siri voices)? What does a user need to download, and where in System Settings do they find the voice downloads?
3. On Windows, `System.Speech` only sees older SAPI voices. Can we reach the newer OneCore voices and the Narrator natural voices (via WinRT `Windows.Media.SpeechSynthesis`, or another API)? Is that possible from PowerShell or from Node without native modules?
4. Does `speechSynthesis` in a VS Code webview list the same voices as the OS, including the high-quality ones, on Mac and Windows? Does speech continue when the webview panel is hidden or backgrounded?
5. Remote setups (SSH, WSL, Dev Containers, Codespaces): setting `extensionKind` to `"ui"` should keep the extension on the local machine. Confirm that works and the selected text from the remote editor is still available to the local extension host.
6. Does the extension work in VS Code forks (Cursor, Windsurf, VSCodium)? What is needed to publish to Open VSX alongside the Marketplace?
7. Is `Cmd+'` / `Ctrl+'` free in default VS Code keybindings and in common forks? Any known conflicts?
8. One process per sentence: how long does `say` and PowerShell take to start, and is the gap between sentences noticeable? If it is, can one long-running PowerShell process take sentences one by one instead?
9. Best way to turn Markdown into speakable plain text: a small hand-written cleaner (regex-based) versus using `remark` with `strip-markdown`. How should each handle tables (read cell by cell?), ordered/unordered lists, links (read the label, skip the URL), and code blocks?
10. Reading from VS Code's Markdown preview. The preview belongs to the built-in Markdown extension, so its selection isn't handed to other extensions. Which route works best?
    - A script added to the preview with `contributes.markdown.previewScripts`: it sees the selection, can catch the shortcut, and could speak with the browser speech API and light up each sentence in the rendered page. Can it read our voice and speed settings?
    - Copying the preview's selection with VS Code's copy command, reading the clipboard, then putting the old clipboard back. Does copy reach the preview, and is touching the clipboard acceptable?
    - Reading the preview's source file when the preview has focus: the whole file, or from the part on screen.
11. Is the name "Read Aloud 2 Me" available on the VS Code Marketplace and Open VSX? Any trademark concerns?

## 7. Out of scope

- Cloud or paid text-to-speech services.
- Accounts or sign-in.
- Sending text off the computer for any reason.
