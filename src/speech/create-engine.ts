/**
 * Picks the speech engine for this computer. The only file that checks the platform, so the
 * rest of the extension uses the {@link SpeechEngine} interface alone.
 */
import { join } from "node:path";
import { SpeechError } from "./engine";
import type { RunEnd, SpeechEngine, SpeechRun, Voice } from "./engine";
import { MacSayEngine } from "./mac-say-engine";
import { MacAfplayPlayer } from "./online/mac-afplay-player";
import { EdgeSynthesizer } from "./online/edge-synthesizer";
import { OnlineEngine } from "./online/online-engine";
import { WindowsMediaPlayer } from "./online/windows-media-player";
import { spawnProcess } from "./process";
import type { Spawner } from "./process";
import { SwitchingEngine } from "./switching-engine";
import type { SwitchingOptions } from "./switching-engine";
import { WindowsSapiEngine } from "./windows-sapi-engine";

/** File name of the PowerShell speech host inside the extension's `resources` folder. */
export const WINDOWS_HOST_SCRIPT = "speech-host.ps1";

/**
 * Creates the engine for `platform`: online voices and this computer's voices, switched by the
 * user's choice.
 *
 * @param platform - usually `process.platform`
 * @param resourcesDir - absolute path to the extension's `resources` folder
 * @param switching - the user's voice source, and what to do on fallback
 * @param log - receives details worth logging
 * @param spawner - starts processes; tests pass a fake
 */
export function createEngine(
  platform: NodeJS.Platform,
  resourcesDir: string,
  switching: SwitchingOptions,
  log: (message: string) => void = () => undefined,
  spawner: Spawner = spawnProcess,
): SwitchingEngine {
  return new SwitchingEngine(
    createOnlineEngine(platform, resourcesDir, log, spawner),
    createComputerEngine(platform, resourcesDir, spawner),
    switching,
  );
}

/** This computer's voices: `say` on macOS, SAPI through PowerShell on Windows. */
export function createComputerEngine(platform: NodeJS.Platform, resourcesDir: string, spawner: Spawner): SpeechEngine {
  if (platform === "darwin") {
    return new MacSayEngine(spawner);
  }
  if (platform === "win32") {
    return new WindowsSapiEngine(join(resourcesDir, WINDOWS_HOST_SCRIPT), spawner);
  }
  return new UnsupportedEngine(platform);
}

/** Edge's online voices, played with `afplay` on macOS or the PowerShell host on Windows. */
export function createOnlineEngine(
  platform: NodeJS.Platform,
  resourcesDir: string,
  log: (message: string) => void,
  spawner: Spawner,
): SpeechEngine {
  if (platform === "darwin") {
    return new OnlineEngine(new EdgeSynthesizer(), new MacAfplayPlayer(spawner), { log });
  }
  if (platform === "win32") {
    const player = new WindowsMediaPlayer(join(resourcesDir, WINDOWS_HOST_SCRIPT), spawner, log);
    return new OnlineEngine(new EdgeSynthesizer(), player, {
      log,
      beforeSpeak: () => {
        player.warmUp();
      },
    });
  }
  return new UnsupportedEngine(platform);
}

/** Stands in on platforms without an engine, so callers get a clear error instead of a crash. */
class UnsupportedEngine implements SpeechEngine {
  readonly capabilities = { wordEvents: false };

  constructor(private readonly platform: string) {}

  listVoices(): Promise<readonly Voice[]> {
    return Promise.reject(this.error());
  }

  speak(): SpeechRun {
    const ended: Promise<RunEnd> = Promise.resolve({ kind: "failed", error: this.error() });
    return { pause: noop, resume: noop, cancel: noop, ended };
  }

  dispose(): void {
    // Nothing runs, so nothing to stop.
  }

  private error(): SpeechError {
    return new SpeechError("unsupportedPlatform", `No speech engine for platform "${this.platform}".`);
  }
}

function noop(): void {
  // A run that never started has nothing to pause, resume or cancel.
}
