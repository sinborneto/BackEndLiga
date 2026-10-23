export class QueryCache<T> {
  private values = new Map<string, { expires: number; value: T }>();
  private pending = new Map<string, Promise<T>>();
  constructor(
    private ttl = 600000,
    private max = 200,
  ) {}
  get(key: string, fetch: () => Promise<T>): Promise<T> {
    const hit = this.values.get(key);
    if (hit && hit.expires > Date.now())
      return Promise.resolve(structuredClone(hit.value));
    let promise = this.pending.get(key);
    if (!promise) {
      promise = fetch()
        .then((value) => {
          if (this.values.size >= this.max)
            this.values.delete(this.values.keys().next().value!);
          this.values.set(key, { expires: Date.now() + this.ttl, value });
          return value;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, promise);
    }
    return promise.then((value) => structuredClone(value));
  }
}
