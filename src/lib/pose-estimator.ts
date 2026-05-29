"use client";

import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import type {
  ConfidenceLevel,
  CustomerProfile,
  DetectedLandmarks,
  LandmarkPoint,
  MeasurementSet,
  ScanMetadata,
  ScanWarning
} from "./types";
import { measurementsCmToInches } from "./units";

type ScanResult = {
  measurements: MeasurementSet;
  landmarks: DetectedLandmarks;
  metadata: ScanMetadata;
};

type OpenCvModule = {
  imread: (image: HTMLImageElement | HTMLCanvasElement) => Mat;
  Mat: new () => Mat;
  cvtColor: (src: Mat, dst: Mat, code: number) => void;
  mean: (src: Mat) => [number, number, number, number];
  COLOR_RGBA2GRAY: number;
};

type Mat = {
  delete: () => void;
};

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

let landmarkerPromise: Promise<PoseLandmarker> | null = null;
let cvPromise: Promise<OpenCvModule> | null = null;

declare global {
  interface Window {
    cv?: OpenCvModule;
  }
}

async function getPoseLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
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
        numPoses: 1
      });
    })();
  }

  return landmarkerPromise;
}

async function getOpenCv() {
  if (!cvPromise) {
    cvPromise = new Promise((resolve, reject) => {
      if (window.cv?.imread) {
        resolve(window.cv);
        return;
      }

      const existing = document.querySelector<HTMLScriptElement>("script[data-opencv-js]");
      const script = existing ?? document.createElement("script");
      script.dataset.opencvJs = "true";
      script.async = true;
      script.src = "https://docs.opencv.org/4.10.0/opencv.js";
      script.onload = () => {
        if (window.cv?.imread) resolve(window.cv);
        else reject(new Error("OpenCV.js loaded but is not ready."));
      };
      script.onerror = () => reject(new Error("OpenCV.js could not be loaded."));
      if (!existing) document.head.appendChild(script);
    });
  }

  return cvPromise;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => reject(new Error(`Could not read ${file.name}`));
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
      x: Number(point.x.toFixed(5)),
      y: Number(point.y.toFixed(5)),
      z: Number((point.z ?? 0).toFixed(5)),
      visibility: Number((point.visibility ?? 0).toFixed(3))
    };
    return map;
  }, {});
}

async function brightness(cv: OpenCvModule, image: HTMLImageElement) {
  const src = cv.imread(image);
  const gray = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    return cv.mean(gray)[0];
  } finally {
    src.delete();
    gray.delete();
  }
}

function warning(code: ScanWarning["code"], message: string): ScanWarning {
  return { code, message };
}

function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 82) return "High";
  if (score >= 62) return "Medium";
  return "Low";
}

export async function scanMeasurements(profile: CustomerProfile, photos: { front: File; side: File }): Promise<ScanResult> {
  const [landmarker, cv] = await Promise.all([getPoseLandmarker(), getOpenCv()]);
  const [frontImage, sideImage] = await Promise.all([loadImage(photos.front), loadImage(photos.side)]);
  const [frontBrightness, sideBrightness] = await Promise.all([brightness(cv, frontImage), brightness(cv, sideImage)]);
  const front = landmarker.detect(frontImage);
  const side = landmarker.detect(sideImage);
  const frontPoints = front.landmarks[0];
  const sidePoints = side.landmarks[0];

  if (!frontPoints || !sidePoints) {
    throw new Error("Full-body pose landmarks could not be detected. Upload clear front and side photos.");
  }

  const fw = frontImage.naturalWidth || frontImage.width;
  const fh = frontImage.naturalHeight || frontImage.height;
  const sw = sideImage.naturalWidth || sideImage.width;
  const cmPerPx = profile.height / bodyPixelHeight(frontPoints, fh);

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

  const shoulderWidth = horizontalDistance(leftShoulder, rightShoulder, fw) * cmPerPx * 1.08;
  const hipWidth = horizontalDistance(leftHip, rightHip, fw) * cmPerPx * 1.18;
  const chestWidth = shoulderWidth * 0.82;
  const waistWidth = (shoulderWidth * 0.48 + hipWidth * 0.52) * 0.92;
  const sideDepth = Math.max(
    horizontalDistance(sidePoints[11], sidePoints[12], sw),
    horizontalDistance(sidePoints[23], sidePoints[24], sw)
  ) * cmPerPx * 0.82;
  const torso = verticalDistance(shoulderCenter, hipCenter, fh) * cmPerPx;
  const outseam = verticalDistance(hipCenter, ankleCenter, fh) * cmPerPx + profile.height * 0.06;
  const inseam = verticalDistance(midpoint(leftKnee, rightKnee), ankleCenter, fh) * cmPerPx * 1.82;
  const leftSleeve = distance(leftShoulder, leftElbow, fw, fh) + distance(leftElbow, leftWrist, fw, fh);
  const rightSleeve = distance(rightShoulder, rightElbow, fw, fh) + distance(rightElbow, rightWrist, fw, fh);
  const sleeve = ((leftSleeve + rightSleeve) / 2) * cmPerPx;

  const measurements: MeasurementSet = {
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
  const armGap = Math.min(
    horizontalDistance(leftWrist, leftHip, fw),
    horizontalDistance(rightWrist, rightHip, fw)
  ) * cmPerPx;
  const coreVisibility = visibility(frontPoints, [11, 12, 23, 24, 25, 26, 27, 28]);

  if (bounds.minY > 0.04 || bounds.maxY < 0.93) {
    warnings.push(warning("BODY_NOT_FULLY_VISIBLE", "Body is not fully visible from head to feet."));
  }
  if (frontTiltDegrees > 8 || sideTiltDegrees > 10) {
    warnings.push(warning("PHOTO_TILTED", "Photo angle appears tilted; stand straight with the camera level."));
  }
  if (armGap < 5 || visibility(frontPoints, [15, 16]) < 0.55) {
    warnings.push(warning("ARMS_NOT_RELAXED", "Arms do not appear relaxed and visible beside the body."));
  }
  if (feetVisibility < 0.55 || Math.max(leftAnkle.y, rightAnkle.y) > 0.97) {
    warnings.push(warning("FEET_CROPPED", "Feet or ankles appear cropped."));
  }
  if (frontBrightness < 55 || sideBrightness < 55 || frontBrightness > 225 || sideBrightness > 225) {
    warnings.push(warning("LIGHTING_POOR", "Lighting is too dark or overexposed for reliable scanning."));
  }

  const score = clamp(
    Math.round(coreVisibility * 58 + feetVisibility * 18 + Math.min(frontBrightness, sideBrightness) / 5 - warnings.length * 8),
    0,
    100
  );

  return {
    measurements: measurementsCmToInches(measurements),
    landmarks: {
      front: toLandmarkMap(frontPoints),
      side: toLandmarkMap(sidePoints)
    },
    metadata: {
      engine: "mediapipe_pose_opencv",
      confidence: confidenceLevel(score),
      score,
      warnings,
      calibrationCmPerPixel: cmPerPx,
      extracted: {
        shoulderWidth,
        chestWidth,
        waistWidth,
        hipWidth,
        sideDepth,
        torso,
        sleeve,
        inseam,
        outseam,
        neckX: neck.x,
        neckY: neck.y
      },
      imageQuality: {
        frontBrightness: Math.round(frontBrightness),
        sideBrightness: Math.round(sideBrightness),
        frontTiltDegrees: Number(frontTiltDegrees.toFixed(1)),
        sideTiltDegrees: Number(sideTiltDegrees.toFixed(1))
      }
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
