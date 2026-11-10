# Contributing

Thanks for helping with Read Aloud 2 Me.

## Set up

1. Install [Node.js](https://nodejs.org) 22 or later.
2. Clone the repo and run `npm ci`.
3. Open the folder in VS Code and install the recommended extensions when asked.
4. Press F5. A second VS Code window opens with the extension loaded. Changes rebuild on save.

## Before you open a pull request

- Read [AGENTS.md](AGENTS.md). It holds the project's layout, coding standards and naming rules.
- Run `npm run verify`. It checks formatting, types, lint and tests, the same as CI.
- If users will notice the change, add one plain line to `CHANGELOG.md` under `## [Unreleased]`.
- Try the change on macOS or Windows, and say which in the pull request.

## Reporting a bug

Open an issue with your OS, editor and version, the voice you picked, and the text that didn't read as expected.
