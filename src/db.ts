// db.ts
//
// Thin wrapper around Deno's built-in `node:sqlite` module (Deno 2.2+).
// Mirrors the shape of the original DatabaseService.cs: keyed by URL, used
// to skip re-downloading files we already have.
//
// A URL can map to *many* files (a playlist produces one file per item),
// so downloads live in their own table rather than a single FilePath
// column - a single-column design silently forgot every file after the
// first, which was the root cause of "all playlist videos downloaded but
// only the first ever shown again" on repeat visits to the same URL.

import { DatabaseSync } from "node:sqlite";

export interface DownloadRecord {
  id: string;
  url: string;
  filePaths: string[];
  downloadedAt: string; // ISO-8601
}

export class DatabaseService {
  #db: DatabaseSync;

  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath);
  }

  /** Creates the schema if it doesn't exist yet. Call once at startup. */
  initialize(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS Downloads (
        Id TEXT PRIMARY KEY,
        Url TEXT NOT NULL UNIQUE,
        DownloadedAt TEXT NOT NULL
      )
    `);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS DownloadFiles (
        Url TEXT NOT NULL,
        Position INTEGER NOT NULL,
        FilePath TEXT NOT NULL,
        PRIMARY KEY (Url, Position),
        FOREIGN KEY (Url) REFERENCES Downloads(Url) ON DELETE CASCADE
      )
    `);

    // Migrate a pre-existing single-file-per-URL database (older schema
    // had a FilePath column directly on Downloads) into the new table so
    // upgrading in place doesn't lose already-downloaded history.
    const columns = this.#db.prepare(`PRAGMA table_info(Downloads)`).all() as
      { name: string }[];
    if (columns.some((c) => c.name === "FilePath")) {
      this.#db.exec(`
        INSERT OR IGNORE INTO DownloadFiles (Url, Position, FilePath)
        SELECT Url, 0, FilePath FROM Downloads WHERE FilePath IS NOT NULL
      `);
      this.#db.exec(`
        CREATE TABLE Downloads_new (
          Id TEXT PRIMARY KEY,
          Url TEXT NOT NULL UNIQUE,
          DownloadedAt TEXT NOT NULL
        )
      `);
      this.#db.exec(`
        INSERT INTO Downloads_new (Id, Url, DownloadedAt)
        SELECT Id, Url, DownloadedAt FROM Downloads
      `);
      this.#db.exec(`DROP TABLE Downloads`);
      this.#db.exec(`ALTER TABLE Downloads_new RENAME TO Downloads`);
    }
  }

  /** Every file previously downloaded for this URL, in original order. */
  getDownloadByUrl(url: string): DownloadRecord | null {
    const row = this.#db
      .prepare("SELECT Id, Url, DownloadedAt FROM Downloads WHERE Url = ?")
      .get(url) as { Id: string; Url: string; DownloadedAt: string } | undefined;

    if (!row) return null;

    const fileRows = this.#db
      .prepare(
        "SELECT FilePath FROM DownloadFiles WHERE Url = ? ORDER BY Position ASC",
      )
      .all(url) as { FilePath: string }[];

    return {
      id: row.Id,
      url: row.Url,
      filePaths: fileRows.map((f) => f.FilePath),
      downloadedAt: row.DownloadedAt,
    };
  }

  /** Records every file produced for this URL, replacing any prior list. */
  addDownload(id: string, url: string, filePaths: string[]): void {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO Downloads (Id, Url, DownloadedAt)
         VALUES (?, ?, ?)`,
      )
      .run(id, url, new Date().toISOString());

    this.#db.prepare("DELETE FROM DownloadFiles WHERE Url = ?").run(url);
    const insert = this.#db.prepare(
      "INSERT INTO DownloadFiles (Url, Position, FilePath) VALUES (?, ?, ?)",
    );
    filePaths.forEach((filePath, position) => {
      insert.run(url, position, filePath);
    });
  }

  close(): void {
    this.#db.close();
  }
}
