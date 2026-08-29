// Single place the frontend gets the backend's base URL from. Defaults to
// localhost for local dev; set NEXT_PUBLIC_API_URL (e.g. in Vercel's
// project settings) to point a deployed frontend at a deployed backend.
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
