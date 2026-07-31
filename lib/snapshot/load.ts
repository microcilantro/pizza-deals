import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Snapshot } from './types';

/**
 * Snapshot storage: dated JSON files in `data/snapshots/`.
 *
 * Filenames are ISO dates so they sort lexically, which means "newest" is just the last
 * entry. Git provides the history and the diffs — a price change shows up as a reviewable
 * line in a pull request rather than an invisible UPDATE.
 */

export const SNAPSHOT_DIR = path.join(process.cwd(), 'data', 'snapshots');

export async function listSnapshotFiles(dir = SNAPSHOT_DIR): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

export async function loadLatestSnapshot(dir = SNAPSHOT_DIR): Promise<Snapshot | null> {
  const files = await listSnapshotFiles(dir);
  const newest = files.at(-1);
  if (!newest) return null;
  return JSON.parse(await readFile(path.join(dir, newest), 'utf8')) as Snapshot;
}

export async function writeSnapshot(snapshot: Snapshot, dir = SNAPSHOT_DIR): Promise<string> {
  await mkdir(dir, { recursive: true });
  const name = `${snapshot.capturedAt.slice(0, 10)}.json`;
  const file = path.join(dir, name);
  // Pretty-printed on purpose: the diff between two days should be readable by a human.
  await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return file;
}
