"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, PencilLine } from "lucide-react";
import Link from "next/link";
import { downloadMeasurementReport } from "@/lib/pdf";
import { getSupabaseClient, hasSupabaseConfig } from "@/lib/supabase";
import type { MeasurementSubmission, SubmissionStatus } from "@/lib/types";
import { measurementLabels, measurementOrder } from "@/lib/types";
import { formatHeight } from "@/lib/units";

export default function ResultClient({ id }: { id: string }) {
  const [submission, setSubmission] = useState<MeasurementSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      if (!hasSupabaseConfig()) {
        setMessage("Supabase is not configured.");
        setLoading(false);
        return;
      }
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from("measurement_submissions").select("*").eq("id", id).single();
      if (error) setMessage(error.message);
      setSubmission(data as MeasurementSubmission | null);
      setLoading(false);
    }
    load();
  }, [id]);

  async function saveChanges(nextStatus?: SubmissionStatus) {
    if (!submission) return;
    setSaving(true);
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("measurement_submissions")
      .update({
        final_measurements: submission.final_measurements,
        status: nextStatus ?? submission.status
      })
      .eq("id", submission.id);
    if (error) setMessage(error.message);
    else {
      setSubmission({ ...submission, status: nextStatus ?? submission.status });
      setMessage("Measurements saved.");
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <main className="app-shell grid min-h-screen place-items-center">
        <Loader2 className="size-8 animate-spin text-[var(--brass)]" />
      </main>
    );
  }

  if (!submission) {
    return (
      <main className="app-shell grid min-h-screen place-items-center px-4 text-center">
        <div>
          <p className="text-lg font-semibold">Measurement report not found.</p>
          <Link className="mt-4 inline-block text-[var(--oxblood)]" href="/">Start a new measurement</Link>
          {message ? <p className="mt-3 text-sm text-[var(--oxblood)]">{message}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-5 border-b border-black/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brass)]">Measurement report</p>
            <h1 className="mt-1 text-3xl font-semibold">{submission.profile.name}</h1>
            <p className="mt-2 text-sm text-black/60">
              {submission.scan_metadata?.confidence ?? "Not scanned"} confidence · {submission.status}
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => downloadMeasurementReport(submission)} className="flex items-center gap-2 border border-black/15 px-4 py-3 font-semibold">
              <Download className="size-4" />
              PDF
            </button>
            <button onClick={() => saveChanges("Confirmed")} disabled={saving} className="bg-[var(--oxblood)] px-4 py-3 font-semibold text-white disabled:opacity-60">
              Confirm
            </button>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
          <section className="space-y-5">
            <div className="border border-black/10 bg-[#fffaf2]/75 p-5">
              <h2 className="mb-4 text-lg font-semibold">Customer Details</h2>
              <dl className="grid gap-3 text-sm">
                <Row label="Phone" value={submission.profile.phone} />
                <Row label="Height" value={formatHeight(submission.profile.heightFeet, submission.profile.heightInches, submission.profile.height)} />
                <Row label="Gender" value={submission.profile.gender.replaceAll("_", " ")} />
                <Row label="Confidence" value={`${submission.scan_metadata?.confidence ?? "Not available"} (${submission.scan_metadata?.score ?? 0}/100)`} />
              </dl>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(submission.photos).map(([key, url]) =>
                url ? (
                  <a key={key} href={url} target="_blank" className="block border border-black/10 bg-[#fffaf2]/75 p-2" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`${key} photo`} className="aspect-[3/4] w-full object-cover" />
                    <span className="mt-2 block text-xs font-bold uppercase tracking-[0.12em]">{key}</span>
                  </a>
                ) : null
              )}
            </div>
            <div className="border border-black/10 bg-[#fffaf2]/75 p-5">
              <h2 className="mb-4 text-lg font-semibold">Scan Warnings</h2>
              {submission.scan_metadata?.warnings.length ? (
                <ul className="space-y-2 text-sm text-[var(--oxblood)]">
                  {submission.scan_metadata.warnings.map((item) => (
                    <li key={item.code}>{item.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-black/60">No warnings recorded.</p>
              )}
              {submission.scan_metadata?.debug ? (
                <div className="mt-4 border-t border-black/10 pt-4 text-xs leading-5 text-black/55">
                  <p className="font-semibold text-black/70">Debug landmark coverage: {submission.scan_metadata.debug.landmarkCoverage}%</p>
                  <p>Detected: {submission.scan_metadata.debug.detectedLandmarks.join(", ") || "none"}</p>
                  <p>Missing: {submission.scan_metadata.debug.missingLandmarks.join(", ") || "none"}</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="border border-black/10 bg-[#fffaf2]/80 p-5">
            <div className="mb-5 flex items-center gap-3">
              <PencilLine className="size-5 text-[var(--brass)]" />
              <h2 className="text-lg font-semibold">Confirmed Measurements</h2>
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
                    value={submission.final_measurements[key] ?? 0}
                    onChange={(event) =>
                      setSubmission({
                        ...submission,
                        final_measurements: {
                          ...submission.final_measurements,
                          [key]: Number(event.target.value)
                        }
                      })
                    }
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-black/45">in</span>
                  </div>
                </label>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={() => saveChanges("Reviewed")} disabled={saving} className="border border-black/15 px-4 py-3 font-semibold disabled:opacity-60">
                Mark Reviewed
              </button>
              <button onClick={() => saveChanges()} disabled={saving} className="bg-[var(--charcoal)] px-4 py-3 font-semibold text-white disabled:opacity-60">
                Save Changes
              </button>
            </div>
            <p className="mt-5 text-sm leading-6 text-black/60">
              AI measurements are estimates and must be verified by a tailor before stitching.
            </p>
            {message ? <p className="mt-3 text-sm text-[var(--oxblood)]">{message}</p> : null}
          </section>
        </div>
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-black/5 pb-2">
      <dt className="font-semibold text-black/55">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
