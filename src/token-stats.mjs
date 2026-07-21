import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_FILES = 10000;
const MAX_DEPTH = 8;
const TAIL_WINDOWS = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024, 16 * 1024 * 1024];
const SESSION_ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

async function listJsonlFiles(directory, depth = 0, output = []) {
  if (depth > MAX_DEPTH || output.length >= MAX_FILES) return output;
  let handle;
  try {
    handle = await fs.opendir(directory);
  } catch {
    return output;
  }
  for await (const entry of handle) {
    if (output.length >= MAX_FILES) break;
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await listJsonlFiles(fullPath, depth + 1, output);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
      output.push(fullPath);
    }
  }
  return output;
}

function readTotalTokens(record) {
  if (!record || typeof record !== 'object') return null;
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : record;
  const candidates = [
    payload.info?.total_token_usage?.total_tokens,
    payload.total_token_usage?.total_tokens,
    payload.token_usage?.total_tokens,
    record.info?.total_token_usage?.total_tokens,
  ];
  for (const value of candidates) {
    if (Number.isFinite(value) && value >= 0) return Math.floor(value);
  }
  return null;
}

async function inspectTail(filePath, windowSize) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0) return null;
    const length = Math.min(stat.size, windowSize);
    const start = Math.max(0, stat.size - length);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const firstBreak = text.indexOf('\n');
      text = firstBreak >= 0 ? text.slice(firstBreak + 1) : '';
    }
    const lines = text.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line || !line.includes('token')) continue;
      try {
        const total = readTotalTokens(JSON.parse(line));
        if (total !== null) return total;
      } catch {
        // A currently-appended final line or unrelated non-JSON line is ignored.
      }
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function finalTokenTotal(filePath) {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  for (const windowSize of TAIL_WINDOWS) {
    const total = await inspectTail(filePath, windowSize);
    if (total !== null) return total;
    if (windowSize >= stat.size) break;
  }
  return null;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        output[index] = await worker(items[index]);
      } catch {
        output[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, runner));
  return output;
}

export async function collectTokenStats() {
  const userProfile = process.env.USERPROFILE || process.env.HOME;
  const configuredRoot = process.env.CODEX_HOME;
  const codexRoot = path.resolve(configuredRoot || path.join(userProfile || '', '.codex'));
  if (!userProfile && !configuredRoot) {
    return {
      available: false,
      totalTokens: null,
      sessionCount: 0,
      scannedFiles: 0,
      source: 'Codex 本地会话统计',
      reason: 'codex-home-unavailable',
      updatedAt: new Date().toISOString(),
    };
  }

  const roots = [path.join(codexRoot, 'sessions'), path.join(codexRoot, 'archived_sessions')];
  const discovered = [];
  for (const root of roots) await listJsonlFiles(root, 0, discovered);

  const unique = new Map();
  for (const filePath of discovered) {
    const match = filePath.match(SESSION_ID);
    const key = match ? match[1].toLowerCase() : path.basename(filePath).toLowerCase();
    let modified = 0;
    try {
      modified = (await fs.stat(filePath)).mtimeMs;
    } catch {
      continue;
    }
    const previous = unique.get(key);
    if (!previous || modified > previous.modified) unique.set(key, { filePath, modified });
  }

  const files = Array.from(unique.values(), (entry) => entry.filePath);
  const totals = await mapWithConcurrency(files, 8, finalTokenTotal);
  let totalTokens = 0;
  let sessionCount = 0;
  for (const total of totals) {
    if (!Number.isFinite(total)) continue;
    totalTokens += total;
    sessionCount += 1;
  }

  return {
    available: sessionCount > 0,
    totalTokens: sessionCount > 0 ? totalTokens : null,
    sessionCount,
    scannedFiles: files.length,
    source: 'Codex 本地会话 Token 统计',
    formula: 'level = min(64, 1 + floor(4 * log2(1 + totalTokens / 1000000)))',
    updatedAt: new Date().toISOString(),
  };
}
