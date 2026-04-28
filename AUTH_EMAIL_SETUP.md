# Auth Email Setup — Supabase Dashboard Configuration

This app uses Supabase email confirmation. Signup confirmation now uses
the **token-hash flow** (`/auth/confirm`), not the PKCE callback.
The PKCE callback (`/auth/callback`) remains in place to handle any
already-sent emails and other flows. After deploying code changes, the
operator must verify these Supabase dashboard settings.

## Required Supabase Dashboard Settings

### Authentication → URL Configuration

| Setting | Value |
|---------|-------|
| **Site URL** | `https://languageacquisition.net` |

### Redirect URLs (allow list)

Add all of these:

- `https://languageacquisition.net/auth/confirm`
- `https://languageacquisition.net/auth/callback`
- `http://localhost:3000/auth/callback`

If you use Vercel preview deployments for auth testing, also add:

- `https://*-bassams-projects.vercel.app/auth/callback`

(Replace the pattern with your actual Vercel team/scope slug.)

Remove the placeholder `https://yourdomain.com/auth/reset-password`
entry that is currently in the allow list.

### Authentication → Email Templates → Confirm signup

**This template must be changed manually in the Supabase dashboard
after deploy** (it cannot be pushed via the CLI). Go to
**Authentication → Email Templates → Confirm signup** and:

**Subject** (leave as-is or set to):

```
Confirm Your Signup
```

**Message body** — paste this HTML exactly:

```html
<h2>Confirm your signup</h2>
<p>Follow this link to confirm your account:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a></p>
```

This replaces the previous default template that used
`{{ .ConfirmationURL }}`. The reason for the change is that
`{{ .ConfirmationURL }}` triggers a PKCE callback that requires the
PKCE verifier cookie set in the original browser at signup time. When
the confirmation link opens in an email-app webview (Outlook, Gmail,
etc.) instead of the original browser/PWA, the verifier is missing and
confirmation fails with "PKCE code verifier not found in storage".

The token-hash flow does not require any cookie from the original
browser — the link can be opened in any browser/webview and the email
will confirm. After confirmation, the user is redirected to
`/login?confirmed=true`, where they sign in inside their actual app /
PWA context.

`Site URL` (above) must be `https://languageacquisition.net` because
`{{ .SiteURL }}` in the template expands to that value.

### Other email templates

Other templates (password reset, magic link, etc.) still use
`{{ .ConfirmationURL }}` and the existing flows. Do not change them as
part of this fix.

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

## Post-Deploy Dashboard Checklist (token-hash signup confirmation fix)

Run this immediately after the deploy that introduces `/auth/confirm`:

1. **Authentication → Email Templates → Confirm signup**: keep the
   subject as `Confirm Your Signup` and paste the body exactly as:

   ```html
   <h2>Confirm your signup</h2>
   <p>Follow this link to confirm your account:</p>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a></p>
   ```

2. **Authentication → URL Configuration → Site URL**: confirm it is
   `https://languageacquisition.net`.
3. **Authentication → URL Configuration → Redirect URLs**: add
   `https://languageacquisition.net/auth/confirm` to the allow list.
4. **Authentication → URL Configuration → Redirect URLs**: keep the
   existing `https://languageacquisition.net/auth/callback` entry — old
   confirmation links sent before the deploy still target the PKCE
   callback.
5. **Authentication → URL Configuration → Redirect URLs**: remove the
   placeholder `https://yourdomain.com/auth/reset-password` entry.

## End-to-End Verification Checklist

- [ ] `NEXT_PUBLIC_APP_URL` is set to `https://languageacquisition.net` in production environment
- [ ] Supabase Site URL is `https://languageacquisition.net`
- [ ] Supabase Redirect URLs include `https://languageacquisition.net/auth/confirm` and `https://languageacquisition.net/auth/callback`
- [ ] Confirm signup template subject is `Confirm Your Signup` and the HTML body links to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
- [ ] Custom SMTP provider is configured (Resend / Postmark / SES / SendGrid)
- [ ] SPF and DKIM DNS records are published for the sender domain
- [ ] Email rate limit is raised to at least 30/hour
- [ ] **Desktop:** Sign up with a test email — confirmation email arrives, link goes to `/auth/confirm?token_hash=...`, lands on `/login?confirmed=true` showing "Email confirmed. You can now sign in."
- [ ] **Mobile (Outlook / Gmail webview):** Sign up on mobile Safari, open the confirmation email in the email-app webview — confirmation completes and lands on `/login?confirmed=true`. Sign in inside the actual PWA reaches the correct onboarding/placement/home route.
- [ ] Re-clicking an already-used or expired confirmation link shows the friendly "Confirmation link expired or invalid…" message — no raw Supabase error is shown
- [ ] Standalone "Resend confirmation email" form on `/login` works without re-entering the signup code, respects 30-second cooldown, and shows a generic message regardless of whether the email exists
- [ ] Same email + same already-consumed signup code shows the recovery path ("already created but still needs confirmation" or "already confirmed, please sign in"), not "Invalid or already used signup code."
- [ ] A different email cannot reuse a consumed code — shows "Invalid or already used signup code."
- [ ] Existing `/auth/callback` still handles old (pre-deploy) confirmation links without crashing
- [ ] Existing `/auth/callback` calls `markSignupCodeConfirmed` after successful old-style confirmation (check `signup_codes.confirmed_at` on the test user)
- [ ] Backfilled `signup_codes` rows show `confirmed_at` for confirmed users and `null` for the unconfirmed Apple Private Relay user
- [ ] If email does not arrive: check Supabase auth logs and SMTP provider logs

## Email Delivery — External Dependencies

The Supabase project is on the Pro plan, which removes the strict
free-tier email limit. However, email deliverability still depends on
the configured SMTP provider and the sender domain's DNS setup.

**Most impactful fix for deliverability:** configure a custom SMTP
provider and publish SPF + DKIM records for the sender domain
(see the SMTP section above).
