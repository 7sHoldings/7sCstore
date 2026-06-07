# Deploying 7sCstore (Vercel + Supabase + Namecheap)

This app is a Next.js 15 application backed by Supabase Postgres. The recommended
host is **Vercel**. Below is the full path from repo to a live domain.

---

## 1. Prepare the production database (Supabase)

You can reuse your existing Supabase project. Make sure the schema exists:

```bash
# from your machine, with .env pointing at the Supabase project
npm run db:push
```

Create your real admin login (idempotent, does NOT wipe data):

```bash
ADMIN_EMAIL="you@yourdomain.com" ADMIN_PASSWORD="a-strong-password" npm run db:bootstrap
```

> Do **not** run `npm run db:seed` against production — it deletes all data and
> loads demo records. It's for local/demo use only.

---

## 2. Import the repo into Vercel

1. Vercel → **Add New… → Project → Import Git Repository**.
2. Select **7sHoldings/7sCstore** (branch `main`).
3. Framework preset: **Next.js** (auto-detected). Leave Build Command and Output
   as default — Vercel runs `npm install` then `npm run build`, which includes
   `prisma generate`.

---

## 3. Environment variables (Vercel → Project → Settings → Environment Variables)

Add these for the **Production** (and **Preview**) environments:

| Name | Value | Required |
|---|---|---|
| `DATABASE_URL` | Supabase **pooled** URL (port `6543`, `?pgbouncer=true`) | ✅ |
| `DIRECT_URL` | Supabase **direct/session** URL (port `5432`) | ✅ |
| `AUTH_SECRET` | A long random string (see below) | ✅ |
| `ANTHROPIC_API_KEY` | Enables AI insights (else rule-based) | optional |
| `AI_MODEL` | e.g. `claude-sonnet-4-6` | optional |
| `MODI_API_URL`, `MODI_API_KEY` | Live Modi POS feed (else sandbox) | optional |
| `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM` | Email notifications | optional |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS notifications | optional |

Generate a strong `AUTH_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Serverless functions must use the **pooled** connection for `DATABASE_URL`
> (6543 + `pgbouncer=true`) — which is exactly what Supabase's Prisma tab gives
> you. `DIRECT_URL` (5432) is only used for migrations.

Click **Deploy**. When it finishes you'll get a `*.vercel.app` URL — sign in with
the admin you created in step 1.

---

## 4. Connect your Namecheap domain

### In Vercel
1. Project → **Settings → Domains → Add**.
2. Add both `yourdomain.com` and `www.yourdomain.com`.
3. Vercel shows the exact DNS records to create — **use the values Vercel shows**;
   the ones below are the current standard.

### In Namecheap
**Domain List → Manage → Advanced DNS → Add New Record:**

| Type | Host | Value | TTL |
|---|---|---|---|
| `A` | `@` | `76.76.21.21` | Automatic |
| `CNAME` | `www` | `cname.vercel-dns.com.` | Automatic |

- Remove any conflicting default Namecheap records (e.g. the parking-page
  `CNAME @`/URL-redirect records).
- DNS can take a few minutes to a couple of hours to propagate. Vercel issues the
  HTTPS certificate automatically once the records resolve.

Pick which host is canonical in Vercel (e.g. redirect `www` → apex or vice-versa)
under Domains.

---

## 5. Post-deploy checks

- Visit `https://yourdomain.com` → you should land on the login screen.
- Sign in with your admin user.
- Open **Reports → export PDF / Excel** to confirm file generation works in
  serverless (PDF font files are bundled via `outputFileTracingIncludes`).
- The app is installable (PWA) — mobile browsers will offer "Add to Home Screen".

## Notes

- **Redeploys**: every push to `main` triggers a Vercel production deploy; PRs get
  preview deployments automatically.
- **Schema changes**: after changing `prisma/schema.prisma`, run `npm run db:push`
  against the production database (Vercel does not mutate your DB at build time).
- **Secrets**: never commit real values — `.env` is gitignored; production secrets
  live only in Vercel's Environment Variables.
