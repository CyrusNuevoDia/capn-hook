import { HarborRegistry } from "./harbor/registry";
import { simulateGulls } from "./gulls";

const registry = new HarborRegistry();

export function main() {
  registry.register({ vesselName: "Jolly Roger", lengthMeters: 34, arrivedAt: new Date() });
  simulateGulls(12);
  return registry.invoiceAll();
}
