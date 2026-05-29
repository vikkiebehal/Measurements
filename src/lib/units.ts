import type { MeasurementSet } from "./types";

export const CM_PER_INCH = 2.54;

export function feetInchesToCm(feet: number, inches: number) {
  return (feet * 12 + inches) * CM_PER_INCH;
}

export function cmToInches(cm: number) {
  return cm / CM_PER_INCH;
}

export function roundToHalfInch(inches: number) {
  return Math.round(inches * 2) / 2;
}

export function formatHeight(feet?: number, inches?: number, fallbackCm?: number) {
  if (typeof feet === "number" && typeof inches === "number") {
    return `${feet} ft ${inches} in`;
  }

  if (typeof fallbackCm === "number") {
    const totalInches = Math.round(cmToInches(fallbackCm));
    return `${Math.floor(totalInches / 12)} ft ${totalInches % 12} in`;
  }

  return "Not provided";
}

export function formatInches(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "0 in";
  return `${value} in`;
}

export function measurementsCmToInches(measurements: MeasurementSet): MeasurementSet {
  return Object.fromEntries(
    Object.entries(measurements).map(([key, value]) => [key, roundToHalfInch(cmToInches(value))])
  ) as MeasurementSet;
}
