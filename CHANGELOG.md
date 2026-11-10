# Changelog

All notable changes to Read Aloud 2 Me are written here, newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Read the selection aloud with `Cmd+'` on Mac or `Ctrl+'` on Windows. Press it again or `Esc` to stop.
- Read Aloud in the right-click menu when text is selected.
- With nothing selected, read from the cursor to the end of the file, or the whole file.
- Markdown is read as plain prose. Code blocks, images and front matter are skipped silently.
- Reading goes one sentence at a time, with previous, next, pause and stop buttons in the editor title bar.
- The sentence and word being read are marked in the editor, and text already read is dimmed.
- A reader panel beside the editor shows clean sentences. Click one to read from there. Text size can be changed.
- The status bar shows the place, speed and voice while reading.
- Pick Voice lists the voices installed on the computer, best first. Set Speed picks a speed from half to twice as fast.
- Read from the Markdown preview.
- Natural online voices from Microsoft Edge, on Mac and Windows, with the computer's own voices as an offline option and automatic fallback.
- The word being read stands out more, and the selection no longer hides the highlights.
- `Ctrl+'` also works on Windows keyboard layouts that report the quote key differently.
