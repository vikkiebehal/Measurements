export type Gender = "male" | "female" | "non_binary" | "prefer_not_to_say";
export type SubmissionStatus = "New" | "Reviewed" | "Confirmed";
export type ConfidenceLevel = "High" | "Medium" | "Low";

export type CustomerProfile = {
  name: string;
  phone: string;
  height: number;
  heightFeet: number;
  heightInches: number;
  gender: Gender;
};

export type MeasurementKey =
  | "shoulder"
  | "chest"
  | "neck"
  | "waist"
  | "hip"
  | "sleeve"
  | "shirtLength"
  | "jacketLength"
  | "trouserLength"
  | "inseam"
  | "outseam"
  | "thigh";

export type MeasurementSet = Record<MeasurementKey, number>;

export type PhotoUrls = {
  front: string;
  side: string;
  back?: string;
};

export type ScanWarningCode =
  | "BODY_NOT_FULLY_VISIBLE"
  | "PHOTO_TILTED"
  | "ARMS_NOT_RELAXED"
  | "FEET_CROPPED"
  | "LIGHTING_POOR";

export type ScanWarning = {
  code: ScanWarningCode;
  message: string;
};

export type LandmarkPoint = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export type DetectedLandmarks = {
  front: Record<string, LandmarkPoint>;
  side: Record<string, LandmarkPoint>;
};

export type ScanMetadata = {
  engine: "mediapipe_pose_opencv";
  confidence: ConfidenceLevel;
  score: number;
  warnings: ScanWarning[];
  calibrationCmPerPixel: number;
  extracted: Record<string, number>;
  imageQuality: {
    frontBrightness: number;
    sideBrightness: number;
    frontTiltDegrees: number;
    sideTiltDegrees: number;
  };
};

export type ScanProgressStage = "idle" | "uploading" | "detecting" | "calculating" | "complete";

export type ScanProgress = {
  stage: ScanProgressStage;
  label: string;
  progress: number;
};

export type ScanResult = {
  measurements: MeasurementSet;
  landmarks: DetectedLandmarks;
  metadata: ScanMetadata;
  compressedPhotos?: {
    front: File;
    side: File;
  };
};

export type MeasurementSubmission = {
  id: string;
  created_at: string;
  status: SubmissionStatus;
  profile: CustomerProfile;
  photos: PhotoUrls;
  detected_landmarks?: DetectedLandmarks;
  estimated_measurements: MeasurementSet;
  final_measurements: MeasurementSet;
  scan_metadata?: ScanMetadata;
  pose_metadata?: Record<string, unknown>;
};

export const measurementLabels: Record<MeasurementKey, string> = {
  shoulder: "Shoulder Width",
  chest: "Chest",
  neck: "Neck",
  waist: "Waist",
  hip: "Hip",
  sleeve: "Sleeve Length",
  shirtLength: "Shirt Length",
  jacketLength: "Jacket Length",
  trouserLength: "Trouser Length",
  inseam: "Inseam",
  outseam: "Outseam",
  thigh: "Thigh"
};

export const measurementOrder = Object.keys(measurementLabels) as MeasurementKey[];
