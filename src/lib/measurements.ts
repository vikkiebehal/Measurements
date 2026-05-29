import type { CustomerProfile, MeasurementSet } from "./types";

export function createEmptyMeasurements(_profile?: CustomerProfile): MeasurementSet {
  return {
    shoulder: 0,
    chest: 0,
    neck: 0,
    waist: 0,
    hip: 0,
    sleeve: 0,
    shirtLength: 0,
    jacketLength: 0,
    trouserLength: 0,
    inseam: 0,
    outseam: 0,
    thigh: 0
  };
}
