# Global Business Manager (GBM)

Private deployment for Global Deal Inc.

## Stack
- Static HTML/JS frontend (no build framework)
- Supabase (PostgreSQL + Auth + Storage) as backend
- Hosted on Vercel
- PDF export via jsPDF + html2canvas

## Deployment

This app is deployed via GitHub → Vercel.

### Environment variables required in Vercel

Both must be set in **Project Settings → Environment Variables**:

- `SUPABASE_URL` — your Supabase project URL (e.g. `https://abcd.supabase.co`)
- `SUPABASE_ANON_KEY` — your Supabase anon/publishable key

### Build process

Vercel runs `node build.js` at build time, which injects the env vars into `src/config.js`.

## Database

Schema lives in Supabase. Tables:
- `settings` (one row per user)
- `customers`
- `invoices`
- `quotes`
- `expenses`

Storage buckets:
- `receipts` — expense receipt files (images + PDFs)
- `logos` — uploaded business logos

Row Level Security is enabled on all tables — users only see their own data.

## Local testing

To test locally, you'd need to manually edit `src/config.js` to insert your Supabase URL and anon key directly, then serve the folder with any static server (e.g. `npx serve .`). Remember to revert before committing.

## License

Private. Not for distribution.
