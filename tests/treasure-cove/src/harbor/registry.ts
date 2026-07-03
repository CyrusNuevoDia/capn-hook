import { mooringFee } from "./fees";

export type Berth = {
  vesselName: string;
  lengthMeters: number;
  arrivedAt: Date;
};

export class HarborRegistry {
  private berths: Berth[] = [];

  register(berth: Berth) {
    this.berths.push(berth);
  }

  invoiceAll() {
    return this.berths.map((b) => ({
      vesselName: b.vesselName,
      amount: mooringFee(b),
    }));
  }
}
