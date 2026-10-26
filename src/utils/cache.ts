import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ApiError } from "../types/card.types.js";

type Entry<T> = { expires: number; savedAt: number; value: T };
export interface CacheOptions<T> {
  // JSON file that keeps entries across restarts.
  file?: string;
  // Serve an expired entry when the portal fails (5xx or unexpected errors).
  stale?: (value: T, savedAt: Date, error: unknown) => T;
}
const portalFailure = (error: unknown) =>
  !(error instanceof ApiError) || error.status >= 500;

export class QueryCache<T> {
  private values = new Map<string, Entry<T>>();
  private pending = new Map<string, Promise<T>>();
  private saveTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private ttl = 600000,
    private max = 200,
    private options: CacheOptions<T> = {},
  ) {
    if (!options.file) return;
    try {
      const saved = JSON.parse(readFileSync(options.file, "utf8")) as Array<
        [string, Entry<T>]
      >;
      this.values = new Map(saved.slice(-max));
    } catch {
      /* Missing or unreadable cache file: start empty. */
    }
  }
  get(key: string, fetch: () => Promise<T>): Promise<T> {
    const hit = this.values.get(key);
    if (hit && hit.expires > Date.now())
      return Promise.resolve(structuredClone(hit.value));
    let promise = this.pending.get(key);
    if (!promise) {
      promise = fetch()
        .then((value) => {
          this.values.delete(key);
          if (this.values.size >= this.max)
            this.values.delete(this.values.keys().next().value!);
          this.values.set(key, {
            expires: Date.now() + this.ttl,
            savedAt: Date.now(),
            value,
          });
          this.scheduleSave();
          return value;
        })
        .catch((error: unknown) => {
          const old = this.values.get(key);
          if (old && this.options.stale && portalFailure(error))
            return this.options.stale(
              structuredClone(old.value),
              new Date(old.savedAt),
              error,
            );
          throw error;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, promise);
    }
    return promise.then((value) => structuredClone(value));
  }
  private scheduleSave() {
    if (!this.options.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 1000);
    this.saveTimer.unref();
  }
  flush() {
    const file = this.options.file;
    if (!file || !this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify([...this.values]));
      renameSync(`${file}.tmp`, file);
    } catch (error) {
      console.error("Não foi possível salvar o cache", error);
    }
  }
}
