export type Gull = { id: number; hunger: number };

export function simulateGulls(count: number): Gull[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    hunger: (id * 7) % 10,
  }));
}
