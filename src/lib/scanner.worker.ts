import type { ScanProgress } from "./types";

type WorkerPhoto = {
  buffer: ArrayBuffer;
  type: string;
  name: string;
  size: number;
};

type ScanRequest = {
  photos: {
    front: WorkerPhoto;
    side: WorkerPhoto;
  };
};

type PreparedImage = {
  buffer: ArrayBuffer;
  type: string;
  name: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  brightness: number;
};

const workerScope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<ScanRequest>) => void | Promise<void>) | null;
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 720;
const JPEG_QUALITY = 0.82;

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

async function prepareImage(photo: WorkerPhoto, label: string): Promise<PreparedImage> {
  assertPhoto(photo, label);
  if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") {
    throw new Error("Image scanner is not supported in this browser. Please update your browser and try again.");
  }

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
  canvas.width = 0;
  canvas.height = 0;

  return {
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

workerScope.onmessage = async (event: MessageEvent<ScanRequest>) => {
  try {
    postProgress(4, "uploading", "Uploading image...");
    const front = await prepareImage(event.data.photos.front, "Front");
    postProgress(18, "uploading", "Uploading image...");
    const side = await prepareImage(event.data.photos.side, "Side");
    workerScope.postMessage(
      {
        type: "prepared",
        prepared: {
          front,
          side
        }
      },
      [front.buffer, side.buffer]
    );
  } catch (error) {
    workerScope.postMessage({ type: "error", message: error instanceof Error ? error.message : "Image preparation failed." });
  }
};
