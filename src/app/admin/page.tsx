"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import Link from "next/link";
import { downloadMeasurementReport } from "@/lib/pdf";
import { getSupabaseClient, hasSupabaseConfig } from "@/lib/supabase";
import type { MeasurementSubmission, SubmissionStatus } from "@/lib/types";
import { formatHeight, formatInches } from "@/lib/units";

const statuses: SubmissionStatus[] = ["New", "Reviewed", "Confirmed"];

export default function AdminPage() {
  const [items, setItems] = useState<MeasurementSubmission[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SubmissionStatus | "All">("All");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      if (!hasSupabaseConfig()) {
        setMessage("Supabase is not configured.");
        setLoading(false);
        return;
      }
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("measurement_submissions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) setMessage(error.message);
      setItems((data || []) as MeasurementSubmission[]);
      setLoading(false);
    }
    load();
  }, []);

  async function updateStatus(id: string, nextStatus: SubmissionStatus) {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("measurement_submissions").update({ status: nextStatus }).eq("id", id);
    if (error) setMessage(error.message);
    else setItems((current) => current.map((item) => (item.id === id ? { ...item, status: nextStatus } : item)));
  }

  const filtered = items.filter((item) => {
    const haystack = `${item.profile.name} ${item.profile.phone}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (status === "All" || item.status === status);
  });

  return (
    <main className="app-shell min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-5 border-b border-black/10 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brass)]">Atelier desk</p>
            <h1 className="mt-1 text-3xl font-semibold">Admin Dashboard</h1>
            <p className="mt-2 text-sm text-black/60">Review customer photos, estimates, final measurements, and order status.</p>
          </div>
          <Link href="/" className="text-sm font-semibold text-[var(--oxblood)]">New measurement</Link>
        </header>

        <div className="mb-5 grid gap-3 md:grid-cols-[1fr_220px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/45" />
            <input className="field pl-10" placeholder="Search customer or phone" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <select className="field" value={status} onChange={(event) => setStatus(event.target.value as SubmissionStatus | "All")}>
            <option value="All">All statuses</option>
            {statuses.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="grid min-h-64 place-items-center">
            <Loader2 className="size-8 animate-spin text-[var(--brass)]" />
          </div>
        ) : (
          <div className="overflow-x-auto border border-black/10 bg-[#fffaf2]/80">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead className="bg-[var(--charcoal)] text-[#f7f3ec]">
                <tr>
                  <Th>Customer</Th>
                  <Th>Photos</Th>
                  <Th>AI Measurements</Th>
                  <Th>Final</Th>
                  <Th>Confidence</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-black/10 align-top">
                    <td className="p-4">
                      <p className="font-semibold">{item.profile.name}</p>
                      <p className="mt-1 text-black/60">{item.profile.phone}</p>
                      <p className="text-black/60">{formatHeight(item.profile.heightFeet, item.profile.heightInches, item.profile.height)} · {item.profile.gender.replaceAll("_", " ")}</p>
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        {Object.entries(item.photos).map(([key, url]) =>
                          url ? (
                            <a key={key} href={url} target="_blank" rel="noreferrer" className="block">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={`${key} view`} className="h-20 w-14 object-cover" />
                            </a>
                          ) : null
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-black/70">{summary(item.estimated_measurements)}</td>
                    <td className="p-4 text-black/70">{summary(item.final_measurements)}</td>
                    <td className="p-4">
                      <p className="font-semibold">{item.scan_metadata?.confidence ?? "Not available"}</p>
                      <p className="text-black/55">{item.scan_metadata?.score ?? 0}/100</p>
                      {item.scan_metadata?.warnings.length ? <p className="mt-1 text-[var(--oxblood)]">{item.scan_metadata.warnings.length} warning(s)</p> : null}
                    </td>
                    <td className="p-4">
                      <select className="field min-w-32" value={item.status} onChange={(event) => updateStatus(item.id, event.target.value as SubmissionStatus)}>
                        {statuses.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-2">
                        <Link href={`/result/${item.id}`} className="font-semibold text-[var(--oxblood)]">Open</Link>
                        <button type="button" onClick={() => downloadMeasurementReport(item)} className="text-left font-semibold text-[var(--charcoal)]">
                          Export PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td className="p-8 text-center text-black/55" colSpan={7}>No submissions found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}

        {message ? <p className="mt-4 text-sm text-[var(--oxblood)]">{message}</p> : null}
      </section>
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="p-4 text-xs font-bold uppercase tracking-[0.14em]">{children}</th>;
}

function summary(measurements: MeasurementSubmission["final_measurements"]) {
  return `Shoulder ${formatInches(measurements.shoulder)} · Chest ${formatInches(measurements.chest)} · Waist ${formatInches(measurements.waist)} · Inseam ${formatInches(measurements.inseam)}`;
}
