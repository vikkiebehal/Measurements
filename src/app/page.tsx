"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Camera, Loader2, ScanLine, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { emptyMeasurements, scanMeasurements } from "@/lib/pose-estimator";
import { getSupabaseClient, hasSupabaseConfig } from "@/lib/supabase";
import type { CustomerProfile, DetectedLandmarks, Gender, MeasurementSet, PhotoUrls, ScanMetadata, ScanProgress } from "@/lib/types";
import { measurementLabels, measurementOrder } from "@/lib/types";
import { feetInchesToCm } from "@/lib/units";

const initialProfile: CustomerProfile = {
  name: "",
  phone: "",
  height: feetInchesToCm(5, 10),
  heightFeet: 5,
  heightInches: 10,
  gender: "male"
};

type PhotoFiles = {
  front?: File;
  side?: File;
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"];

export default function Home() {
  const router = useRouter();
  const [profile, setProfile] = useState<CustomerProfile>(initialProfile);
  const [photos, setPhotos] = useState<PhotoFiles>({});
  const [measurements, setMeasurements] = useState<MeasurementSet>(() => emptyMeasurements());
  const [estimated, setEstimated] = useState<MeasurementSet>(() => emptyMeasurements());
  const [landmarks, setLandmarks] = useState<DetectedLandmarks | null>(null);
  const [scanMetadata, setScanMetadata] = useState<ScanMetadata | null>(null);
  const [compressedPhotos, setCompressedPhotos] = useState<PhotoFiles>({});
  const [scanProgress, setScanProgress] = useState<ScanProgress>({
    stage: "idle",
    label: "Ready to scan",
    progress: 0
  });
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const configured = hasSupabaseConfig();

  const [photoPreviews, setPhotoPreviews] = useState({ front: "", side: "" });

  useEffect(() => {
    const front = photos.front ? URL.createObjectURL(photos.front) : "";
    const side = photos.side ? URL.createObjectURL(photos.side) : "";
    setPhotoPreviews({ front, side });

    return () => {
      if (front) URL.revokeObjectURL(front);
      if (side) URL.revokeObjectURL(side);
    };
  }, [photos]);

  function updateProfile<K extends keyof CustomerProfile>(key: K, value: CustomerProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function updateHeight(key: "heightFeet" | "heightInches", value: number) {
    setProfile((current) => {
      const next = { ...current, [key]: value };
      return {
        ...next,
        height: feetInchesToCm(next.heightFeet, next.heightInches)
      };
    });
  }

  async function runScan(nextProfile = profile, nextPhotos = photos) {
    if (!nextPhotos.front || !nextPhotos.side) {
      setMessage("Upload both front and side full-body photos to scan.");
      return null;
    }

    setIsScanning(true);
    setMessage("");
    setScanProgress({ stage: "uploading", label: "Uploading image...", progress: 0 });
    try {
      const scan = await scanMeasurements(nextProfile, { front: nextPhotos.front, side: nextPhotos.side }, setScanProgress);
      setEstimated(scan.measurements);
      setMeasurements(scan.measurements);
      setLandmarks(scan.landmarks);
      setScanMetadata(scan.metadata);
      setCompressedPhotos(scan.compressedPhotos ?? {});
      setScanProgress({ stage: "complete", label: "Calculating measurements...", progress: 100 });
      return scan;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image scan failed.");
      setLandmarks(null);
      setScanMetadata(null);
      setCompressedPhotos({});
      setScanProgress({ stage: "idle", label: "Ready to scan", progress: 0 });
      return null;
    } finally {
      setIsScanning(false);
    }
  }

  async function handlePhotoChange(key: keyof PhotoFiles, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setMessage("Only JPG and PNG photos are supported.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setMessage("Each photo must be 5MB or smaller.");
      event.target.value = "";
      return;
    }

    const nextPhotos = { ...photos, [key]: file };
    setPhotos(nextPhotos);
    setCompressedPhotos({});
    setScanMetadata(null);
    setLandmarks(null);
    setScanProgress({ stage: "uploading", label: "Uploading image...", progress: nextPhotos.front && nextPhotos.side ? 8 : 0 });
    if (nextPhotos.front && nextPhotos.side) {
      await runScan(profile, nextPhotos);
    }
  }

  async function uploadPhoto(id: string, key: keyof PhotoFiles, file?: File) {
    if (!file) return undefined;
    const supabase = getSupabaseClient();
    const extension = file.name.split(".").pop() || "jpg";
    const path = `${id}/${key}.${extension}`;
    const { error } = await supabase.storage.from("measurement-photos").upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from("measurement-photos").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) {
      setMessage("Add Supabase environment variables before saving live scans.");
      return;
    }
    if (!photos.front || !photos.side) {
      setMessage("Front and side full-body photos are required.");
      return;
    }
    let currentMetadata = scanMetadata;
    let currentLandmarks = landmarks;
    let currentEstimated = estimated;
    let currentMeasurements = measurements;
    let currentCompressedPhotos = compressedPhotos;
    if (!currentMetadata || !currentLandmarks) {
      const scan = await runScan();
      if (!scan) {
        setMessage("Run a successful image scan before saving.");
        return;
      }
      currentMetadata = scan.metadata;
      currentLandmarks = scan.landmarks;
      currentEstimated = scan.measurements;
      currentMeasurements = scan.measurements;
      currentCompressedPhotos = scan.compressedPhotos ?? {};
    }

    setIsSaving(true);
    setMessage("");
    try {
      const supabase = getSupabaseClient();
      const id = crypto.randomUUID();
      const photoUrls: PhotoUrls = {
        front: (await uploadPhoto(id, "front", currentCompressedPhotos.front ?? photos.front)) ?? "",
        side: (await uploadPhoto(id, "side", currentCompressedPhotos.side ?? photos.side)) ?? ""
      };
      const { error } = await supabase.from("measurement_submissions").insert({
        id,
        status: "New",
        profile,
        photos: photoUrls,
        detected_landmarks: currentLandmarks,
        estimated_measurements: currentEstimated,
        final_measurements: currentMeasurements,
        scan_metadata: currentMetadata,
        pose_metadata: currentMetadata
      });
      if (error) throw error;
      router.push(`/result/${id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save scan.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-black/10 pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brass)]">AI Scan Atelier</p>
            <h1 className="mt-1 text-2xl font-semibold text-[var(--charcoal)] sm:text-4xl">Measurement Scanner</h1>
          </div>
          <a href="/admin" className="text-sm font-semibold text-[var(--oxblood)]">Admin</a>
        </header>

        <form onSubmit={handleSubmit} className="grid flex-1 gap-8 py-8 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-8">
            <section>
              <div className="mb-5 flex items-center gap-3">
                <ScanLine className="size-5 text-[var(--brass)]" />
                <h2 className="text-xl font-semibold">Customer Scan Details</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" value={profile.name} onChange={(value) => updateProfile("name", value)} required />
                <Field label="Phone" value={profile.phone} onChange={(value) => updateProfile("phone", value)} required />
                <HeightInput
                  feet={profile.heightFeet}
                  inches={profile.heightInches}
                  onFeetChange={(value) => updateHeight("heightFeet", value)}
                  onInchesChange={(value) => updateHeight("heightInches", value)}
                />
                <Select label="Gender" value={profile.gender} options={["male", "female", "non_binary", "prefer_not_to_say"]} onChange={(value) => updateProfile("gender", value as Gender)} />
              </div>
            </section>

            <section>
              <div className="mb-5 flex items-center gap-3">
                <Camera className="size-5 text-[var(--brass)]" />
                <h2 className="text-xl font-semibold">Image Scan Uploads</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <PhotoInput label="Front" preview={photoPreviews.front} onChange={(event) => handlePhotoChange("front", event)} />
                <PhotoInput label="Side" preview={photoPreviews.side} onChange={(event) => handlePhotoChange("side", event)} />
              </div>
              <button
                type="button"
                onClick={() => runScan()}
                disabled={isScanning}
                className="mt-4 flex w-full items-center justify-center gap-2 border border-black/15 bg-[#fffaf2]/75 px-4 py-3 font-semibold disabled:opacity-60"
              >
                {isScanning ? <Loader2 className="size-5 animate-spin" /> : <ScanLine className="size-5" />}
                Scan Images
              </button>
            </section>

            <div className="border border-[var(--brass)]/30 bg-[var(--charcoal)] p-5 text-[#f7f3ec]">
              <div className="mb-3 flex items-center gap-3">
                <ShieldCheck className="size-5 text-[var(--brass)]" />
                <p className="font-semibold">Tailor verification required</p>
              </div>
              <p className="text-sm leading-6 text-[#e8dece]">
                AI measurements are estimates and must be verified by a tailor before stitching.
              </p>
            </div>
          </div>

          <aside className="space-y-6">
            <section className="border border-black/10 bg-[#fffaf2]/80 p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brass)]">MediaPipe + OpenCV scan</p>
                  <h2 className="mt-1 text-xl font-semibold">Editable Final Measurements</h2>
                </div>
                <ConfidenceBadge confidence={scanMetadata?.confidence} score={scanMetadata?.score} />
              </div>
              <div className="measure-grid">
                {measurementOrder.map((key) => (
                  <label key={key}>
                    <span className="label">{measurementLabels[key]}</span>
                    <div className="relative">
                    <input
                      className="field pr-10"
                      type="number"
                      step="0.5"
                      value={measurements[key]}
                      onChange={(event) => setMeasurements((current) => ({ ...current, [key]: Number(event.target.value) }))}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-black/45">in</span>
                    </div>
                  </label>
                ))}
              </div>
            </section>

            <section className="border border-black/10 bg-[#fffaf2]/75 p-5">
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="font-semibold">{scanProgress.label}</p>
                <p className="text-sm font-semibold text-[var(--brass)]">{scanProgress.progress}%</p>
              </div>
              <div className="h-2 overflow-hidden bg-black/10">
                <div className="h-full bg-[var(--brass)] transition-all duration-300" style={{ width: `${scanProgress.progress}%` }} />
              </div>
            </section>

            <section className="border border-black/10 bg-[#fffaf2]/75 p-5">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="size-5 text-[var(--brass)]" />
                <h2 className="font-semibold">Scan Warnings</h2>
              </div>
              {scanMetadata?.warnings.length ? (
                <ul className="space-y-2 text-sm text-[var(--oxblood)]">
                  {scanMetadata.warnings.map((item) => (
                    <li key={item.code}>{item.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-black/60">{scanMetadata ? "No scan warnings detected." : "Upload both photos to scan for visibility, angle, arms, feet, and lighting."}</p>
              )}
            </section>

            {message ? <p className="border border-[var(--oxblood)]/25 bg-white/70 p-3 text-sm text-[var(--oxblood)]">{message}</p> : null}

            <button
              type="submit"
              disabled={isSaving || isScanning}
              className="flex w-full items-center justify-center gap-2 bg-[var(--oxblood)] px-5 py-4 font-semibold text-white disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="size-5 animate-spin" /> : <ArrowRight className="size-5" />}
              Save Scan
            </button>
          </aside>
        </form>
      </section>
    </main>
  );
}

function ConfidenceBadge({ confidence, score }: { confidence?: string; score?: number }) {
  const label = confidence ?? "Not scanned";
  const color = confidence === "High" ? "bg-[var(--sage)]" : confidence === "Medium" ? "bg-[var(--brass)]" : "bg-[var(--oxblood)]";
  return (
    <div className={`${color} min-w-32 px-3 py-2 text-center text-sm font-semibold text-white`}>
      {label}
      {typeof score === "number" ? <span className="block text-xs font-normal text-white/80">{score}/100</span> : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <input className="field" type={type} value={value} required={required} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function HeightInput({
  feet,
  inches,
  onFeetChange,
  onInchesChange
}: {
  feet: number;
  inches: number;
  onFeetChange: (value: number) => void;
  onInchesChange: (value: number) => void;
}) {
  return (
    <fieldset>
      <legend className="label">Height</legend>
      <div className="grid grid-cols-2 gap-3">
        <label className="relative">
          <select className="field pr-10" value={feet} onChange={(event) => onFeetChange(Number(event.target.value))}>
            {[4, 5, 6, 7].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-black/45">ft</span>
        </label>
        <label className="relative">
          <select className="field pr-10" value={inches} onChange={(event) => onInchesChange(Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-black/45">in</span>
        </label>
      </div>
    </fieldset>
  );
}

function PhotoInput({
  label,
  preview,
  onChange
}: {
  label: string;
  preview: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="block border border-black/10 bg-[#fffaf2]/70 p-3">
      <span className="label">{label} Full-Body Photo</span>
      <div className="mb-3 grid aspect-[3/4] place-items-center overflow-hidden bg-[var(--linen)]">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={`${label} preview`} className="h-full w-full object-cover" />
        ) : (
          <Camera className="size-8 text-[var(--sage)]" />
        )}
      </div>
      <input required type="file" accept="image/jpeg,image/png" className="w-full text-sm" onChange={onChange} />
      <p className="mt-2 text-xs text-black/50">JPG or PNG, 5MB max. Images are resized to 720px before scanning.</p>
    </label>
  );
}
