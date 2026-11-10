/**
 * Temporary audio files for the online voices. Each run writes its sentences' MP3 files to its
 * own folder in the system temp folder; the folder is removed in the background when the run
 * ends, and leftovers from a crash are swept on the next read, so nothing accumulates.
 * Must never throw into reading: callers log failures.
 */
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/** Removes a run's folder of audio files. Must never throw; failures are for the log only. */
export type FolderRemover = (dir: string) => Promise<void>;

/**
 * Deletes a folder in the background. On Windows the media player may still hold a file for a
 * moment after it was told to close it, so deletion retries before giving up.
 */
export const removeFolder: FolderRemover = (dir) =>
  rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

/** Every run's audio folder starts with this, inside the system temp folder. */
export const FOLDER_PREFIX = "read-aloud-2-me-";

/** Leftover folders older than this are removed; anything newer may belong to another window. */
export const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Removes audio folders left behind when VS Code was closed mid-read or a delete kept failing,
 * so the temp folder never grows. Only folders with our prefix, older than {@link STALE_AFTER_MS}.
 *
 * @param root - the temp folder to look in
 * @param remove - deletes one folder
 * @param now - the current time, for tests
 * @returns how many folders were removed
 */
export async function sweepStaleFolders(root: string, remove: FolderRemover, now = Date.now()): Promise<number> {
  const names = (await readdir(root)).filter((name) => name.startsWith(FOLDER_PREFIX));
  let removed = 0;
  for (const name of names) {
    const dir = join(root, name);
    const info = await stat(dir);
    if (info.isDirectory() && now - info.mtimeMs > STALE_AFTER_MS) {
      await remove(dir);
      removed++;
    }
  }
  return removed;
}
