import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import type {
  ConfidenceLevel,
  CustomerProfile,
  DetectedLandmarks,
  LandmarkPoint,
  MeasurementSet,
  ScanMetadata,
  ScanProgress,
  ScanWarning
} from "./types";
import { measurementsCmToInches } from "./units";

const workerScope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<ScanRequest>) => void | Promise<void>) | null;
};

type WorkerPhoto = {
  buffer: ArrayBuffer;
  type: string;
  name: string;
  size: number;
};

type ScanRequest = {
  profile: CustomerProfile;
  photos: {
    front: WorkerPhoto;
    side: WorkerPhoto;
  };
};

type PreparedImage = {
  bitmap: ImageBitmap;
  buffer: ArrayBuffer;
  type: string;
  name: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  brightness: number;
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 720;
const JPEG_QUALITY = 0.82;

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

function postProgress(progress: number, stage: ScanProgress["stage"], label: string) {
  workerScope.postMessage({ type: "progress", progress: { progress, stage, label } });
}

function assertPhoto(photo: WorkerPhoto, label: string) {
  if (!["image/jpeg", "image/png"].includes(photo.type)) {
    throw new Error(`${label} photo must be JPG or PNG.`);
  }
  if (photo.size > MAX_FILE_SIZE) {
    throw new Error(`${label} photo must be 5MB or smaller.`);
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
          delegate: "CPU"
        },
        runningMode: "IMAGE",
        numPoses: 1,
        minPoseDetectionConfidence: 0.35,
        minPosePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35
      });
    })();
  }

  return landmarkerPromise;
}

async function prepareImage(photo: WorkerPhoto, label: string): Promise<PreparedImage> {
  assertPhoto(photo, label);
  const originalBlob = new Blob([photo.buffer], { type: photo.type });
  const original = await createImageBitmap(originalBlob);
  const originalWidth = original.width;
  const originalHeight = original.height;

  if (originalWidth < 320 || originalHeight < 520) {
    original.close();
    throw new Error(`${label} photo resolution is too low. Upload a clearer full-body image.`);
  }

  const scale = Math.min(1, MAX_IMAGE_WIDTH / originalWidth);
  const width = Math.round(originalWidth * scale);
  const height = Math.round(originalHeight * scale);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    original.close();
    throw new Error("Image processing is not supported in this browser.");
  }

  context.drawImage(original, 0, 0, width, height);
  original.close();

  const sample = context.getImageData(0, 0, width, height);
  let luminance = 0;
  const stride = Math.max(4, Math.floor(sample.data.length / 50000) * 4);
  let count = 0;
  for (let index = 0; index < sample.data.length; index += stride) {
    luminance += sample.data[index] * 0.299 + sample.data[index + 1] * 0.587 + sample.data[index + 2] * 0.114;
    count += 1;
  }
  const brightness = luminance / Math.max(count, 1);

  if (brightness < 45) {
    throw new Error(`${label} photo is too dark. Use brighter, even lighting.`);
  }

  const compressedBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  const compressedBuffer = await compressedBlob.arrayBuffer();
  const bitmap = await createImageBitmap(compressedBlob);
  canvas.width = 0;
  canvas.height = 0;

  return {
    bitmap,
    buffer: compressedBuffer,
    type: "image/jpeg",
    name: photo.name.replace(/\.(png|jpe?g)$/i, "") + "-scan.jpg",
    width,
    height,
    originalWidth,
    originalHeight,
    brightness
  };
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

function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 82) return "High";
  if (score >= 62) return "Medium";
  return "Low";
}

async function scan(profile: CustomerProfile, frontImage: PreparedImage, sideImage: PreparedImage) {
  postProgress(38, "detecting", "Detecting body landmarks...");
  const landmarker = await getPoseLandmarker();
  const front = landmarker.detect(frontImage.bitmap as unknown as HTMLCanvasElement);
  postProgress(58, "detecting", "Detecting body landmarks...");
  const side = landmarker.detect(sideImage.bitmap as unknown as HTMLCanvasElement);
  const frontPoints = front.landmarks[0];
  const sidePoints = side.landmarks[0];

  if (!frontPoints || !sidePoints) {
    throw new Error("Full-body pose landmarks could not be detected. Upload clear front and side photos.");
  }

  postProgress(74, "calculating", "Calculating measurements...");
  const cmPerPx = profile.height / bodyPixelHeight(frontPoints, frontImage.height);
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
  const shoulderWidth = horizontalDistance(leftShoulder, rightShoulder, frontImage.width) * cmPerPx * 1.08;
  const hipWidth = horizontalDistance(leftHip, rightHip, frontImage.width) * cmPerPx * 1.18;
  const chestWidth = shoulderWidth * 0.82;
  const waistWidth = (shoulderWidth * 0.48 + hipWidth * 0.52) * 0.92;
  const sideDepth = Math.max(
    horizontalDistance(sidePoints[11], sidePoints[12], sideImage.width),
    horizontalDistance(sidePoints[23], sidePoints[24], sideImage.width)
  ) * cmPerPx * 0.82;
  const torso = verticalDistance(shoulderCenter, hipCenter, frontImage.height) * cmPerPx;
  const outseam = verticalDistance(hipCenter, ankleCenter, frontImage.height) * cmPerPx + profile.height * 0.06;
  const inseam = verticalDistance(midpoint(leftKnee, rightKnee), ankleCenter, frontImage.height) * cmPerPx * 1.82;
  const leftSleeve =
    distance(leftShoulder, leftElbow, frontImage.width, frontImage.height) +
    distance(leftElbow, leftWrist, frontImage.width, frontImage.height);
  const rightSleeve =
    distance(rightShoulder, rightElbow, frontImage.width, frontImage.height) +
    distance(rightElbow, rightWrist, frontImage.width, frontImage.height);
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
  const armGap = Math.min(
    horizontalDistance(leftWrist, leftHip, frontImage.width),
    horizontalDistance(rightWrist, rightHip, frontImage.width)
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
  if (frontImage.brightness < 55 || sideImage.brightness < 55 || frontImage.brightness > 225 || sideImage.brightness > 225) {
    warnings.push(warning("LIGHTING_POOR", "Lighting is too dark or overexposed for reliable scanning."));
  }

  if (warnings.some((item) => ["BODY_NOT_FULLY_VISIBLE", "FEET_CROPPED", "LIGHTING_POOR", "PHOTO_TILTED"].includes(item.code))) {
    throw new Error(warnings[0].message);
  }

  const score = clamp(
    Math.round(coreVisibility * 58 + feetVisibility * 18 + Math.min(frontImage.brightness, sideImage.brightness) / 5 - warnings.length * 8),
    0,
    100
  );

  const metadata: ScanMetadata = {
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
      frontBrightness: Math.round(frontImage.brightness),
      sideBrightness: Math.round(sideImage.brightness),
      frontTiltDegrees: Number(frontTiltDegrees.toFixed(1)),
      sideTiltDegrees: Number(sideTiltDegrees.toFixed(1))
    }
  };

  return {
    measurements: measurementsCmToInches(measurementsCm),
    landmarks: {
      front: toLandmarkMap(frontPoints),
      side: toLandmarkMap(sidePoints)
    },
    metadata
  };
}

workerScope.onmessage = async (event: MessageEvent<ScanRequest>) => {
  let frontImage: PreparedImage | undefined;
  let sideImage: PreparedImage | undefined;

  try {
    postProgress(4, "uploading", "Uploading image...");
    frontImage = await prepareImage(event.data.photos.front, "Front");
    postProgress(18, "uploading", "Uploading image...");
    sideImage = await prepareImage(event.data.photos.side, "Side");
    postProgress(30, "detecting", "Detecting body landmarks...");
    const result = await scan(event.data.profile, frontImage, sideImage);
    postProgress(100, "complete", "Calculating measurements...");
    workerScope.postMessage(
      {
        type: "result",
        result: {
          ...result,
          compressedPhotos: {
            front: { buffer: frontImage.buffer, type: frontImage.type, name: frontImage.name },
            side: { buffer: sideImage.buffer, type: sideImage.type, name: sideImage.name }
          }
        }
      },
      [frontImage.buffer, sideImage.buffer]
    );
  } catch (error) {
    workerScope.postMessage({ type: "error", message: error instanceof Error ? error.message : "Image scan failed." });
  } finally {
    frontImage?.bitmap.close();
    sideImage?.bitmap.close();
  }
};
