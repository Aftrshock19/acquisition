# Auth Email Setup — Supabase Dashboard Configuration

This app uses Supabase email confirmation (PKCE / code exchange flow).
After deploying code changes, the operator must verify these Supabase dashboard settings.

## Required Supabase Dashboard Settings

### Authentication → URL Configuration

| Setting | Value |
|---------|-------|
| **Site URL** | `https://languageacquisition.net` |

### Redirect URLs (allow list)

Add all of these:

- `https://languageacquisition.net/auth/callback`
- `http://localhost:3000/auth/callback`

If you use Vercel preview deployments for auth testing, also add:

- `https://*-bassams-projects.vercel.app/auth/callback`

(Replace the pattern with your actual Vercel team/scope slug.)

### Authentication → Email Templates

Supabase sends confirmation emails using its built-in templates.
The `{{ .ConfirmationURL }}` variable already encodes the redirect URL
passed via `emailRedirectTo` in the signup call.

**Do not** hardcode a URL in the email template — the app passes the
correct redirect at signup time via `NEXT_PUBLIC_APP_URL`.

### Authentication → Rate Limits (Pro plan)

The app includes a "Resend confirmation" button, so users may trigger
multiple email sends. Tune the per-hour email limit accordingly.

**Authentication → Rate Limits → Emails sent per hour**: raise to
`30–100` (default is too low for real usage with resend).

### SMTP — Custom Provider (strongly recommended)

Even on Pro, the Supabase built-in SMTP sender is intended for
development/testing and has lower deliverability than a dedicated
provider. Configure a custom SMTP provider for production:

**Project Settings → Authentication → SMTP Settings**

Recommended providers: Resend, Postmark, AWS SES, SendGrid.

You will need:
- A sender address on a domain you control (e.g. `noreply@languageacquisition.net`)
- DNS records (SPF + DKIM) — your provider will give you exact values to add
- SMTP host / port / username / password from the provider

After configuring, send a test signup to confirm:
- Email arrives in the inbox (not spam)
- From address is your custom sender, not `noreply@mail.app.supabase.io`

## Environment Variables

| Variable | Where | Value |
|----------|-------|-------|
| `NEXT_PUBLIC_APP_URL` | Production (Vercel / hosting) | `https://languageacquisition.net` |
| `NEXT_PUBLIC_APP_URL` | `.env.local` (development) | `https://languageacquisition.net` (or omit — defaults to `http://localhost:3000`) |

The app resolves the canonical URL via `lib/url.ts`:
1. `NEXT_PUBLIC_APP_URL` (if set)
2. `VERCEL_URL` (auto-set on Vercel preview deploys)
3. `http://localhost:3000` (fallback)

## End-to-End Verification Checklist

- [ ] `NEXT_PUBLIC_APP_URL` is set to `https://languageacquisition.net` in production environment
- [ ] Supabase Site URL is `https://languageacquisition.net`
- [ ] Supabase Redirect URLs include `https://languageacquisition.net/auth/callback`
- [ ] Custom SMTP provider is configured (Resend / Postmark / SES / SendGrid)
- [ ] SPF and DKIM DNS records are published for the sender domain
- [ ] Email rate limit is raised to at least 30/hour
- [ ] Sign up with a test email on production
- [ ] Confirmation email arrives in the inbox (not spam)
- [ ] From address is the custom sender, not `noreply@mail.app.supabase.io`
- [ ] Confirmation link points to `https://languageacquisition.net/auth/callback?code=...`
- [ ] Clicking the link lands on the site (not localhost)
- [ ] User ends up on `/onboarding` (first sign-up) or `/` (returning user)
- [ ] Sign in with password still works
- [ ] Resend confirmation button works and respects 30-second cooldown
- [ ] If email does not arrive: check Supabase auth logs and SMTP provider logs

## Email Delivery — External Dependencies

The Supabase project is on the Pro plan, which removes the strict
free-tier email limit. However, email deliverability still depends on
the configured SMTP provider and the sender domain's DNS setup.

**Most impactful fix for deliverability:** configure a custom SMTP
provider and publish SPF + DKIM records for the sender domain
(see the SMTP section above).
