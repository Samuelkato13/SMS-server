# Deploy SMS API on Railway

1. **New project** → **Deploy from GitHub** → select `Samuelkato13/SMS-server`, branch `main`.

2. **Variables** (Project → service → Variables):

   | Name | Value |
   |------|--------|
   | `DATABASE_URL` | Supabase **transaction pooler** URI (encode `@` in password as `%40`) |
   | `SESSION_SECRET` | Long random string |
   | `NODE_ENV` | `production` |

3. **Build / start** (defaults are fine if Railway detects Node):

   - Install: `npm install`
   - Build: `npm run build`
   - Start: `npm start` → runs `node dist/index.js`

4. After deploy, copy the **public URL** (e.g. `https://your-service.up.railway.app`) and point your Vercel frontend at it:

   - Rewrite `/api/*` to `https://YOUR-RAILWAY-URL/api/*` (see your client `vercel.json`).

5. **CORS / cookies**: If the API uses session cookies, ensure the server allows your Vercel origin and `credentials` (same as you did for Render).
