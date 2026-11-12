# KhetMitra frontend deployment

This is the existing KhetMitra website source with the crop advice, crop validation, mandi price, and fertilizer-plan screens configured to call a separately deployed API service.

## Environment

Set these at frontend build/runtime as appropriate for your TanStack Start host:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
VITE_KHETMITRA_API_URL=https://YOUR-BACKEND-DOMAIN
```

`VITE_KHETMITRA_API_URL` must be the backend's public HTTPS origin, with no trailing slash. Rebuild/redeploy after changing it because Vite exposes this value at build time.

## Deploy

Deploy this folder as the website using the existing TanStack Start/Vite project setup. Use Node.js 20+ and the package scripts in `package.json` (`npm install`, `npm run build`, then the start command required by your selected TanStack Start host/adapter).

The frontend continues to use Supabase Auth and the existing Supabase tables for account/profile data. For crop advice, validation, mandi prices, and fertilizer plan it sends the signed-in user's Supabase access token to the backend API.
