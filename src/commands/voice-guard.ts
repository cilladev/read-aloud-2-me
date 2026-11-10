/**
 * Keeps track of which voices are installed and whether the configured one is usable.
 * `say` quietly falls back to the default voice when a name is wrong, so the configured voice is
 * checked against the installed list, and the user is told once.
 */
import * as vscode from "vscode";
import type { Voice } from "../speech/engine";

/** Caches the voice list and remembers a configured voice that is not installed. */
export class VoiceGuard {
  /** Installed voices, listed once and reused; voices rarely change while VS Code runs. */
  private voices: Promise<readonly Voice[]> | undefined;
  /** A configured voice that turned out not to be installed; the system voice is used instead. */
  private missing: string | undefined;

  /**
   * @param list - lists this computer's installed voices
   * @param log - the extension's log channel
   */
  constructor(
    private readonly list: () => Promise<readonly Voice[]>,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  /** Lists installed voices. `fresh` lists again instead of using the cache. */
  installed(fresh = false): Promise<readonly Voice[]> {
    const voices = (fresh ? undefined : this.voices) ?? this.list();
    this.voices = voices;
    void voices.catch(() => {
      // Listing failed: forget it so the next call tries again. The caller reports the error.
      this.voices = undefined;
    });
    return voices;
  }

  /** The voice to speak with: the configured one, or undefined (system voice) if it is missing. */
  usable(voice: string | undefined): string | undefined {
    return voice === this.missing ? undefined : voice;
  }

  /** Forgets a missing voice, for example after the setting changes. */
  reset(): void {
    this.missing = undefined;
  }

  /**
   * Checks the configured voice and warns once if it is not installed.
   *
   * @param voice - the configured voice id, or undefined for the system voice
   * @param onPickVoice - runs when the user clicks "Pick Voice" in the warning
   */
  async check(voice: string | undefined, onPickVoice: () => Promise<void>): Promise<void> {
    if (voice === undefined || voice === this.missing) {
      return;
    }
    try {
      const voices = await this.installed();
      if (voices.some((candidate) => candidate.id === voice)) {
        return;
      }
      this.missing = voice;
      void vscode.window
        .showWarningMessage(`The voice "${voice}" isn't installed. Reading with the system voice.`, "Pick Voice")
        .then((choice) => (choice ? onPickVoice() : undefined));
    } catch (error: unknown) {
      this.log.warn(`Could not list voices to check "${voice}": ${String(error)}`);
    }
  }
}
