import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atelier Measurement Studio",
  description: "AI-assisted tailoring measurement intake for coat, pant, shirt, and suit orders."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
