"use client";

import type { CustomerProfile, DetectedLandmarks, LandmarkPoint, MeasurementSet, ScanMetadata, ScanProgress, ScanResult, ScanWarning } from "./types";
import { measurementsCmToInches } from "./units";

type NormalizedLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

type PoseLandmarkerLike = {
  detect: (image: HTMLImageElement) => { landmarks: NormalizedLandmark[][] };
};

type PreparedWorkerPhoto = {
  buffer: ArrayBuffer;
  type: string;
  name: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  brightness: number;
};

type WorkerMessage =
  | { type: "progress"; progress: ScanProgress }
  | { type: "error"; message: string }
  | { type: "prepared"; prepared: { front: PreparedWorkerPhoto; side: PreparedWorkerPhoto } };

const SCAN_TIMEOUT_MS = 15000;

const landmarkNames = [
  "nose",
  "leftEyeInner",
  "leftEye",
  "leftEyeOuter",
  "rightEyeInner",
  "rightEye",
  "rightEyeOuter",
  "leftEar",
  "rightEar",
  "mouthLeft",
  "mouthRight",
  "leftShoulder",
  "rightShoulder",
  "leftElbow",
  "rightElbow",
  "leftWrist",
  "rightWrist",
  "leftPinky",
  "rightPinky",
  "leftIndex",
  "rightIndex",
  "leftThumb",
  "rightThumb",
  "leftHip",
  "rightHip",
  "leftKnee",
  "rightKnee",
  "leftAnkle",
  "rightAnkle",
  "leftHeel",
  "rightHeel",
  "leftFootIndex",
  "rightFootIndex"
] as const;

let landmarkerPromise: Promise<PoseLandmarkerLike> | null = null;

export async function initializeScanner() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm"
      );

      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
          delegate: "GPU"
        },
        runningMode: "IMAGE",
        numPoses: 1,
        minPoseDetectionConfidence: 0.35,
        minPosePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35
      }) as Promise<PoseLandmarkerLike>;
    })();
  }

  return landmarkerPromise;
}

function prepareImagesInWorker(
  photos: { front: File; side: File },
  onProgress?: (progress: ScanProgress) => void
): Promise<{
  front: PreparedWorkerPhoto;
  side: PreparedWorkerPhoto;
}> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return Promise.reject(new Error("Scanner can only run in a browser."));
  }

  const worker = new Worker(new URL("./scanner.worker.ts", import.meta.url), { type: "module" });

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

      resolve(message.prepared);
    };

    worker.onerror = (error) => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(error.message || "Image preparation failed."));
    };

    Promise.all([photos.front.arrayBuffer(), photos.side.arrayBuffer()])
      .then(([frontBuffer, sideBuffer]) => {
        worker.postMessage(
          {
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
      })
      .catch((error) => {
        window.clearTimeout(timeout);
        worker.terminate();
        reject(error);
      });
  });
}

function fileFromPrepared(photo: PreparedWorkerPhoto) {
  return new File([photo.buffer], photo.name, { type: photo.type });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof URL === "undefined" || typeof Image === "undefined") {
      reject(new Error("Image scanner is not available outside the browser."));
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}`));
    };
    image.src = url;
  });
}

function distance(a: NormalizedLandmark, b: NormalizedLandmark, width: number, height: number) {
  const dx = (a.x - b.x) * width;
  const dy = (a.y - b.y) * height;
  return Math.hypot(dx, dy);
}

function horizontalDistance(a: NormalizedLandmark, b: NormalizedLandmark, width: number) {
  return Math.abs(a.x - b.x) * width;
}

function verticalDistance(a: NormalizedLandmark, b: NormalizedLandmark, height: number) {
  return Math.abs(a.y - b.y) * height;
}

function midpoint(a: NormalizedLandmark, b: NormalizedLandmark) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    visibility: ((a.visibility ?? 0) + (b.visibility ?? 0)) / 2
  };
}

function roundHalf(value: number) {
  return Math.round(value * 2) / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function visibility(points: NormalizedLandmark[], indexes: number[]) {
  return indexes.reduce((sum, index) => sum + (points[index]?.visibility ?? 0), 0) / indexes.length;
}

function bodyBounds(points: NormalizedLandmark[]) {
  const visible = points.filter((point) => (point.visibility ?? 0) > 0.35);
  return {
    minX: Math.min(...visible.map((point) => point.x)),
    maxX: Math.max(...visible.map((point) => point.x)),
    minY: Math.min(...visible.map((point) => point.y)),
    maxY: Math.max(...visible.map((point) => point.y))
  };
}

function bodyPixelHeight(points: NormalizedLandmark[], height: number) {
  const bounds = bodyBounds(points);
  return Math.max((bounds.maxY - bounds.minY) * height, 1);
}

function angleDegrees(a: NormalizedLandmark, b: NormalizedLandmark) {
  return Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
}

function toLandmarkMap(points: NormalizedLandmark[]) {
  return landmarkNames.reduce<Record<string, LandmarkPoint>>((map, name, index) => {
    const point = points[index];
    map[name] = {
      x: Number(point.x.toFixed(4)),
      y: Number(point.y.toFixed(4)),
      z: Number((point.z ?? 0).toFixed(4)),
      visibility: Number((point.visibility ?? 0).toFixed(2))
    };
    return map;
  }, {});
}

function warning(code: ScanWarning["code"], message: string): ScanWarning {
  return { code, message };
}

function confidenceLevel(score: number) {
  if (score >= 82) return "High";
  if (score >= 62) return "Medium";
  return "Low";
}

function calculateMeasurements(
  profile: CustomerProfile,
  frontPoints: NormalizedLandmark[],
  sidePoints: NormalizedLandmark[],
  front: PreparedWorkerPhoto,
  side: PreparedWorkerPhoto
) {
  const cmPerPx = profile.height / bodyPixelHeight(frontPoints, front.height);
  const leftShoulder = frontPoints[11];
  const rightShoulder = frontPoints[12];
  const leftHip = frontPoints[23];
  const rightHip = frontPoints[24];
  const leftKnee = frontPoints[25];
  const rightKnee = frontPoints[26];
  const leftAnkle = frontPoints[27];
  const rightAnkle = frontPoints[28];
  const leftWrist = frontPoints[15];
  const rightWrist = frontPoints[16];
  const leftElbow = frontPoints[13];
  const rightElbow = frontPoints[14];
  const neck = midpoint(leftShoulder, rightShoulder);
  const hipCenter = midpoint(leftHip, rightHip);
  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const ankleCenter = midpoint(leftAnkle, rightAnkle);
  const shoulderWidth = horizontalDistance(leftShoulder, rightShoulder, front.width) * cmPerPx * 1.08;
  const hipWidth = horizontalDistance(leftHip, rightHip, front.width) * cmPerPx * 1.18;
  const chestWidth = shoulderWidth * 0.82;
  const waistWidth = (shoulderWidth * 0.48 + hipWidth * 0.52) * 0.92;
  const sideDepth = Math.max(horizontalDistance(sidePoints[11], sidePoints[12], side.width), horizontalDistance(sidePoints[23], sidePoints[24], side.width)) * cmPerPx * 0.82;
  const torso = verticalDistance(shoulderCenter, hipCenter, front.height) * cmPerPx;
  const outseam = verticalDistance(hipCenter, ankleCenter, front.height) * cmPerPx + profile.height * 0.06;
  const inseam = verticalDistance(midpoint(leftKnee, rightKnee), ankleCenter, front.height) * cmPerPx * 1.82;
  const leftSleeve = distance(leftShoulder, leftElbow, front.width, front.height) + distance(leftElbow, leftWrist, front.width, front.height);
  const rightSleeve = distance(rightShoulder, rightElbow, front.width, front.height) + distance(rightElbow, rightWrist, front.width, front.height);
  const sleeve = ((leftSleeve + rightSleeve) / 2) * cmPerPx;

  const measurementsCm: MeasurementSet = {
    shoulder: roundHalf(clamp(shoulderWidth, 34, 62)),
    chest: roundHalf(clamp(chestWidth * 2 + sideDepth * 1.55, 72, 150)),
    neck: roundHalf(clamp(shoulderWidth * 0.38 + 20, 30, 52)),
    waist: roundHalf(clamp(waistWidth * 2 + sideDepth * 1.42, 58, 145)),
    hip: roundHalf(clamp(hipWidth * 2 + sideDepth * 1.48, 76, 155)),
    sleeve: roundHalf(clamp(sleeve * 0.95, 46, 76)),
    shirtLength: roundHalf(clamp(torso + profile.height * 0.14, 62, 94)),
    jacketLength: roundHalf(clamp(torso + profile.height * 0.1, 56, 90)),
    trouserLength: roundHalf(clamp(outseam, 86, 124)),
    inseam: roundHalf(clamp(inseam, 60, 98)),
    outseam: roundHalf(clamp(outseam, 86, 124)),
    thigh: roundHalf(clamp((hipWidth * 2 + sideDepth * 1.48) * 0.31, 44, 82))
  };

  const warnings: ScanWarning[] = [];
  const bounds = bodyBounds(frontPoints);
  const frontTiltDegrees = angleDegrees(leftShoulder, rightShoulder);
  const sideTiltDegrees = angleDegrees(sidePoints[11], sidePoints[12]);
  const feetVisibility = visibility(frontPoints, [27, 28, 29, 30, 31, 32]);
  const armGap = Math.min(horizontalDistance(leftWrist, leftHip, front.width), horizontalDistance(rightWrist, rightHip, front.width)) * cmPerPx;
  const coreVisibility = visibility(frontPoints, [11, 12, 23, 24, 25, 26, 27, 28]);

  if (bounds.minY > 0.04 || bounds.maxY < 0.93) warnings.push(warning("BODY_NOT_FULLY_VISIBLE", "Body is not fully visible from head to feet."));
  if (frontTiltDegrees > 8 || sideTiltDegrees > 10) warnings.push(warning("PHOTO_TILTED", "Photo angle appears tilted; stand straight with the camera level."));
  if (armGap < 5 || visibility(frontPoints, [15, 16]) < 0.55) warnings.push(warning("ARMS_NOT_RELAXED", "Arms do not appear relaxed and visible beside the body."));
  if (feetVisibility < 0.55 || Math.max(leftAnkle.y, rightAnkle.y) > 0.97) warnings.push(warning("FEET_CROPPED", "Feet or ankles appear cropped."));
  if (front.brightness < 55 || side.brightness < 55 || front.brightness > 225 || side.brightness > 225) warnings.push(warning("LIGHTING_POOR", "Lighting is too dark or overexposed for reliable scanning."));

  if (warnings.some((item) => ["BODY_NOT_FULLY_VISIBLE", "FEET_CROPPED", "LIGHTING_POOR", "PHOTO_TILTED"].includes(item.code))) {
    throw new Error(warnings[0].message);
  }

  const score = clamp(Math.round(coreVisibility * 58 + feetVisibility * 18 + Math.min(front.brightness, side.brightness) / 5 - warnings.length * 8), 0, 100);
  const metadata: ScanMetadata = {
    engine: "mediapipe_pose_opencv",
    confidence: confidenceLevel(score),
    score,
    warnings,
    calibrationCmPerPixel: cmPerPx,
    extracted: { shoulderWidth, chestWidth, waistWidth, hipWidth, sideDepth, torso, sleeve, inseam, outseam, neckX: neck.x, neckY: neck.y },
    imageQuality: {
      frontBrightness: Math.round(front.brightness),
      sideBrightness: Math.round(side.brightness),
      frontTiltDegrees: Number(frontTiltDegrees.toFixed(1)),
      sideTiltDegrees: Number(sideTiltDegrees.toFixed(1))
    }
  };

  return {
    measurements: measurementsCmToInches(measurementsCm),
    landmarks: { front: toLandmarkMap(frontPoints), side: toLandmarkMap(sidePoints) } satisfies DetectedLandmarks,
    metadata
  };
}

export async function scanMeasurements(
  profile: CustomerProfile,
  photos: { front: File; side: File },
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanResult> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Scanner can only run in a browser.");
  }

  const landmarker = await initializeScanner();
  if (!landmarker) throw new Error("Scanner could not initialize. Please refresh and try again.");
  const prepared = await prepareImagesInWorker(photos, onProgress);
  onProgress?.({ stage: "detecting", label: "Detecting body landmarks...", progress: 38 });
  const frontFile = fileFromPrepared(prepared.front);
  const sideFile = fileFromPrepared(prepared.side);
  const [frontImage, sideImage] = await Promise.all([loadImage(frontFile), loadImage(sideFile)]);
  const frontResult = landmarker.detect(frontImage);
  onProgress?.({ stage: "detecting", label: "Detecting body landmarks...", progress: 58 });
  const sideResult = landmarker.detect(sideImage);
  const frontPoints = frontResult.landmarks[0];
  const sidePoints = sideResult.landmarks[0];
  if (!frontPoints || !sidePoints) throw new Error("Full-body pose landmarks could not be detected. Upload clear front and side photos.");
  onProgress?.({ stage: "calculating", label: "Calculating measurements...", progress: 78 });
  const result = calculateMeasurements(profile, frontPoints, sidePoints, prepared.front, prepared.side);
  onProgress?.({ stage: "complete", label: "Calculating measurements...", progress: 100 });

  return {
    ...result,
    compressedPhotos: {
      front: frontFile,
      side: sideFile
    }
  };
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
