import jsPDF from "jspdf";
import { measurementLabels, measurementOrder, type MeasurementSubmission } from "./types";
import { formatHeight, formatInches } from "./units";

export function downloadMeasurementReport(submission: MeasurementSubmission) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const profile = submission.profile;
  const finalMeasurements = submission.final_measurements;

  doc.setFillColor(23, 20, 18);
  doc.rect(0, 0, 595, 112, "F");
  doc.setTextColor(247, 243, 236);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("Atelier Measurement Report", 40, 52);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("AI measurements are estimates and must be verified by a tailor before stitching.", 40, 78);

  doc.setTextColor(23, 20, 18);
  doc.setFontSize(12);
  doc.text(`Customer: ${profile.name}`, 40, 146);
  doc.text(`Phone: ${profile.phone}`, 40, 166);
  doc.text(`Gender: ${profile.gender.replaceAll("_", " ")}`, 40, 186);
  doc.text(`Status: ${submission.status}`, 40, 206);

  doc.text(`Height: ${formatHeight(profile.heightFeet, profile.heightInches, profile.height)}`, 335, 146);
  doc.text(`Confidence: ${submission.scan_metadata?.confidence ?? "Not available"}`, 335, 166);
  doc.text(`Score: ${submission.scan_metadata?.score ?? 0}/100`, 335, 186);

  doc.setFont("helvetica", "bold");
  doc.text("Final Verified Measurements", 40, 276);
  doc.setFont("helvetica", "normal");

  let x = 40;
  let y = 306;
  measurementOrder.forEach((key, index) => {
    doc.text(`${measurementLabels[key]}: ${formatInches(finalMeasurements[key])}`, x, y);
    y += 24;
    if ((index + 1) % 6 === 0) {
      x = 335;
      y = 306;
    }
  });

  doc.setFontSize(9);
  doc.setTextColor(97, 89, 78);
  doc.text("AI measurements are estimates and must be verified by a tailor before stitching.", 40, 746);
  doc.text(`Generated ${new Date().toLocaleString()}`, 40, 770);
  doc.save(`${profile.name.replace(/\s+/g, "-").toLowerCase()}-measurement-report.pdf`);
}
