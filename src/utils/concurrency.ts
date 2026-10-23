/** Compartilhado entre requisições: o limite vale para todo o processo. */
export class ConcurrencyLimiter {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private limit = 3) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("Concorrência deve ser um inteiro positivo");
  }
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit)
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active++;
    try {
      return await task();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}
