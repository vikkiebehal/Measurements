"use client";

import type { CustomerProfile, MeasurementSet, ScanProgress, ScanResult } from "./types";

type WorkerSuccessMessage = {
  type: "result";
  result: Omit<ScanResult, "compressedPhotos"> & {
    compressedPhotos: {
      front: { buffer: ArrayBuffer; type: string; name: string };
      side: { buffer: ArrayBuffer; type: string; name: string };
    };
  };
};

type WorkerProgressMessage = {
  type: "progress";
  progress: ScanProgress;
};

type WorkerErrorMessage = {
  type: "error";
  message: string;
};

type WorkerMessage = WorkerSuccessMessage | WorkerProgressMessage | WorkerErrorMessage;

const SCAN_TIMEOUT_MS = 15000;

export async function scanMeasurements(
  profile: CustomerProfile,
  photos: { front: File; side: File },
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanResult> {
  const worker = new Worker(new URL("./scanner.worker.ts", import.meta.url), { type: "module" });
  const frontBuffer = await photos.front.arrayBuffer();
  const sideBuffer = await photos.side.arrayBuffer();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("Scan taking longer than expected. Please try another photo."));
    }, SCAN_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;

      if (message.type === "progress") {
        onProgress?.(message.progress);
        return;
      }

      window.clearTimeout(timeout);
      worker.terminate();

      if (message.type === "error") {
        reject(new Error(message.message));
        return;
      }

      const { compressedPhotos, ...result } = message.result;
      resolve({
        ...result,
        compressedPhotos: {
          front: new File([compressedPhotos.front.buffer], compressedPhotos.front.name, { type: compressedPhotos.front.type }),
          side: new File([compressedPhotos.side.buffer], compressedPhotos.side.name, { type: compressedPhotos.side.type })
        }
      });
    };

    worker.onerror = (error) => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(error.message || "Image scan failed."));
    };

    worker.postMessage(
      {
        profile,
        photos: {
          front: {
            buffer: frontBuffer,
            type: photos.front.type,
            name: photos.front.name,
            size: photos.front.size
          },
          side: {
            buffer: sideBuffer,
            type: photos.side.type,
            name: photos.side.name,
            size: photos.side.size
          }
        }
      },
      [frontBuffer, sideBuffer]
    );
  });
}

export function emptyMeasurements(): MeasurementSet {
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
