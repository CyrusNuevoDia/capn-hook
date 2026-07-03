import type { Berth } from "./registry";

const RATE_PER_METER_PER_DAY = 4.5;
const HIGH_SEASON_MULTIPLIER = 1.35;

function isHighSeason(date: Date): boolean {
  const month = date.getMonth();
  return month >= 5 && month <= 8; // June through September
}

// Mooring fees: vessel length x daily rate, marked up in high season.
export function mooringFee(berth: Berth): number {
  const base = berth.lengthMeters * RATE_PER_METER_PER_DAY;
  return isHighSeason(berth.arrivedAt) ? base * HIGH_SEASON_MULTIPLIER : base;
}
