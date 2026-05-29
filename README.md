# Atelier Measurement Scanner

Full image-scan AI measurement MVP for tailoring intake. The app uses Next.js, Tailwind CSS, MediaPipe Pose, OpenCV.js, and Supabase. It does not use paid 3DLOOK APIs.

## Features

- Customer enters only name, phone, height, and gender.
- Customer uploads front and side full-body photos.
- MediaPipe Pose detects shoulders, chest/torso area, waist, hips, knees, ankles, wrists, and neck reference points.
- Height calibrates pixel distances into centimeters.
- OpenCV.js checks image brightness for scan quality.
- The app estimates shoulder width, chest, waist, hip, sleeve length, shirt length, jacket length, trouser length, inseam, and outseam.
- Confidence score: High / Medium / Low.
- Warnings for body not fully visible, tilted photos, arms not relaxed, cropped feet, and poor lighting.
- Editable final measurements page for tailor correction.
- Supabase stores uploaded photos, detected landmarks, AI measurements, final measurements, confidence, and warnings.
- Admin dashboard can view photos, review AI measurements, edit final measurements through the result page, update status, and export PDF.
- Required disclaimer: “AI measurements are estimates and must be verified by a tailor before stitching.”

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create a Supabase project and run the SQL in `supabase/schema.sql`.

3. Add environment variables in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

4. Run locally:

```bash
pnpm dev
```

5. Build for production:

```bash
npm run build
```

This workspace does not currently have an `npm` binary installed, so the verified local equivalent was run with the bundled pnpm runner.

## Vercel Deployment

- Import the repository in Vercel.
- Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Use the default Next.js build command.
- Run `supabase/schema.sql` before live submissions.

## Production Security

The included Supabase policies are open for MVP testing with the public anon key. Before production, add admin authentication, restrict read/update policies, use signed storage URLs for photos, and add server-side validation.
