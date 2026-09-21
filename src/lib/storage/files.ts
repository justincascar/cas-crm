import fs from "node:fs";
import path from "node:path";

/** Stored files live beside the SQLite database, off OneDrive. */
export function filesRoot(): string {
  if (process.env.CAS_FILES_DIR) {
    const dir = process.env.CAS_FILES_DIR;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const root = process.env.LOCALAPPDATA || process.env.HOME || process.cwd();
  const dir = path.join(root, "CAS-CRM", "files");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[<>:"/\\|?*\u0000]/g, "_").trim();
  return base || "document.bin";
}

export function storeFileCopy(input: {
  relDir: string;
  originalFilename: string;
  sourcePath?: string;
  buffer?: Buffer;
}): { storedRelpath: string; byteSize: number } {
  const filename = safeFilename(input.originalFilename);
  const relpath = [...input.relDir.split(/[/\\]+/).filter(Boolean), filename].join("/");
  const abs = resolveStoredPath(relpath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fs.existsSync(abs) && fs.statSync(abs).size > 0) {
    return { storedRelpath: relpath, byteSize: fs.statSync(abs).size };
  }
  if (input.sourcePath) {
    fs.copyFileSync(input.sourcePath, abs);
  } else if (input.buffer) {
    fs.writeFileSync(abs, input.buffer);
  } else {
    throw new Error("No file was provided to store.");
  }
  return { storedRelpath: relpath, byteSize: fs.statSync(abs).size };
}

export function storedFileExists(relpath: string): boolean {
  try {
    return fs.existsSync(resolveStoredPath(relpath));
  } catch {
    return false;
  }
}

export function readStoredFile(relpath: string): { buffer: Buffer; absPath: string } {
  const abs = resolveStoredPath(relpath);
  return { buffer: fs.readFileSync(abs), absPath: abs };
}

function resolveStoredPath(relpath: string): string {
  const root = path.resolve(filesRoot());
  const abs = path.resolve(root, ...relpath.split("/"));
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) {
    throw new Error("Invalid stored file path.");
  }
  return abs;
}
