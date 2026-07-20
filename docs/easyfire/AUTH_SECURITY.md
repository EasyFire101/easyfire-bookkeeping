# EasyFire Bookkeeping -- Auth Security Configuration

> **Source security reference.** Publication is established only by exact
> EasyFire-owned remote readback. Deployed Cloudflare Access, native
> authentication, owner existence, and signup behavior remain unverified until
> authenticated live acceptance is recorded in
> [CURRENT_STATE.md](./CURRENT_STATE.md). Agent Foundry is provenance only; it is
> not authentication authority.

**Source:** BigCapital (AGPL v3) -- native local authentication
**Updated:** 2026-07-20
**Runtime status:** Not deployed, reconciled, or live-accepted

---

## 1. Auth Architecture

EasyFire Bookkeeping uses BigCapital's native authentication system:

| Component      | Technology                    | Description                                    |
| -------------- | ----------------------------- | ---------------------------------------------- |
| Auth strategy  | Passport.js (local + JWT)     | Email + password with signed JWTs              |
| Token type     | JWT (HS384)                   | 1-day expiry, signed with `APP_JWT_SECRET`     |
| Global guard   | `MixedAuthGuard`              | Intercepts all requests, checks JWT or API key |
| Public routes  | `@PublicRoute()` decorator    | Exact inventory is documented in section 5.2   |
| Signup control | `SIGNUP_DISABLED` env var     | Blocks `POST /api/auth/signup` when `true`     |
| User store     | System database `users` table | Per-tenant user accounts                       |

**All non-public routes are protected by the global `MixedAuthGuard`**, which checks for a valid JWT bearer token or API key on every request. Routes without a valid token receive HTTP 401.

---

## 2. Signup Lockdown

### 2.1 Configuration

Signup is controlled by three environment variables in `.env`:

| Variable                    | Default           | Purpose                                                              |
| --------------------------- | ----------------- | -------------------------------------------------------------------- |
| `SIGNUP_DISABLED`           | `true` (EasyFire) | When `true`, blocks all new signups unless exceptions are configured |
| `SIGNUP_ALLOWED_DOMAINS`    | _(empty)_         | Comma-separated list of allowed email domains (e.g., `easyfire.fyi`) |
| `SIGNUP_ALLOWED_EMAILS`     | _(empty)_         | Comma-separated list of allowed specific emails                      |
| `SIGNUP_EMAIL_CONFIRMATION` | `false`           | When `true`, requires email verification before account activation   |

### 2.2 Behavior Matrix

| `SIGNUP_DISABLED` | `ALLOWED_EMAILS` / `ALLOWED_DOMAINS` | Signup behavior                                   |
| ----------------- | ------------------------------------ | ------------------------------------------------- |
| `false`           | _(any)_                              | All signups allowed (open registration)           |
| `true`            | Set (non-empty)                      | Only matching emails/domains can sign up          |
| `true`            | Empty                                | **All signups blocked** (403 `SIGNUP_RESTRICTED`) |

### 2.3 Implementation

- **Config registration:** `packages/server/src/common/config/signup-restrictions.ts:6`
- **Validation logic:** `packages/server/src/modules/Auth/commands/AuthSignup.service.ts:111-141`
- **UI awareness:** `packages/webapp/src/containers/Authentication/Login.tsx:60-71` (hides "Sign Up" link when disabled)
- **Meta endpoint:** `GET /api/auth/meta` returns `{ signupDisabled: boolean }`

### 2.4 For Private Launch (Current)

For the intended EasyFire private launch, signup is **disabled**. The candidate
does not create an owner account. The `.env` configuration is:

```
SIGNUP_DISABLED=true
SIGNUP_ALLOWED_DOMAINS=
SIGNUP_ALLOWED_EMAILS=
```

This blocks all self-service registration attempts. Automated owner bootstrap
is retired, so a truly fresh database has no supported first-owner login. Do
not temporarily open signup as a release workaround. Owner onboarding requires
a separate approved design and proof before a fresh production installation is
usable.

### 2.5 Verification Procedure

```powershell
# Attempt unauthenticated signup (should return 403 SIGNUP_RESTRICTED)
Invoke-RestMethod -Uri "http://localhost:3000/api/auth/signup" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"firstName":"Test","lastName":"User","email":"test@example.com","password":"test123"}'
```

Expected: HTTP 403 with error `SIGNUP_RESTRICTED`.

---

## 3. Default Credential Audit

### 3.1 Verification: No Hardcoded Default Credentials

| Check                            | Result               | Evidence                                                           |
| -------------------------------- | -------------------- | ------------------------------------------------------------------ |
| System user seeds                | None found           | No `seed_users` migration or seed file exists                      |
| Hardcoded admin emails/passwords | None found           | Source audit of all `packages/server/src/**`                       |
| CLI user creation commands       | None found           | CLI commands are limited to migration/seed/export only             |
| Docker Compose defaults          | All fake/placeholder | `docker-compose.yml` uses `$DB_USER`, `$DB_PASSWORD` env vars only |
| README/setup documentation       | No defaults          | Setup scripts require environment configuration                    |

The only user creation path is:

1. Self-service signup (`POST /api/auth/signup`) -- **blocked when `SIGNUP_DISABLED=true`**
2. Invite-based onboarding (invite acceptance flow)

There are **no seeded, hardcoded, or default credentials** in any tracked source file.

---

## 4. Synthetic development identity (not owner onboarding)

### 4.1 Scope

Historical local plans used a fake administrator identity. It is synthetic test
data only and is not proof that any current database contains an owner:

**Credentials (fake, dev-only):**

| Field    | Value                  |
| -------- | ---------------------- |
| Email    | `admin@easyfire.local` |
| Password | `easyfire_dev_admin`   |

### 4.2 Production prohibition

Do not use this identity or its password in production. Do not temporarily set
`SIGNUP_DISABLED=false`, populate an allowlist, or invoke the signup endpoint to
work around missing first-owner onboarding. `scripts/production/bootstrap-owner.ps1`
is a non-mutating retirement marker. A supported onboarding/recovery capability
must define exact authorization, backup, audit, failure recovery, and proof
before it can be added to the production path.

### 4.3 Synthetic-only authentication verification

```powershell
# Successful authentication (should return accessToken + tenantId)
$response = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/signin" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"email":"admin@easyfire.local","password":"easyfire_dev_admin"}'

$response.accessToken  # Should be a valid JWT

# Unauthenticated access rejection (should return 401)
Invoke-RestMethod -Uri "http://localhost:3000/api/organizations" `
  -Method GET
```

Expected in a disposable synthetic environment only: authenticated request
returns data; unauthenticated request returns HTTP 401. This example is not a
retained execution receipt and must not be run against production.

---

## 5. Unauthenticated Access Protection

### 5.1 Guard Architecture

All API routes are protected by a global guard chain:

```
Request → MixedAuthGuard → JwtAuthGuard (JWT token) OR ApiKeyAuthGuard (API key)
                        → EnsureUserVerifiedGuard (checks email verification status)
```

| Guard                     | File                                                                  | Role                                                   |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| `MixedAuthGuard`          | `packages/server/src/modules/Auth/api-key/MixedAuth.guard.ts`         | Entry point: routes to JWT or API key auth             |
| `JwtAuthGuard`            | `packages/server/src/modules/Auth/guards/jwt.guard.ts`                | Validates JWT bearer token; skips for `@PublicRoute()` |
| `EnsureUserVerifiedGuard` | `packages/server/src/modules/Auth/guards/EnsureUserVerified.guard.ts` | Blocks unverified users; skips for public routes       |

### 5.2 Public Routes

Five controllers are marked public at class level. Their complete route
inventory under the global `/api` prefix is:

| Route                                  | Purpose / application-level control                        |
| -------------------------------------- | ---------------------------------------------------------- |
| `POST /api/auth/signin`                | Native sign-in                                             |
| `POST /api/auth/signup`                | Blocked when `SIGNUP_DISABLED=true`                        |
| `POST /api/auth/signup/verify`         | Signup verification                                        |
| `POST /api/auth/send_reset_password`   | Password-reset request                                     |
| `POST /api/auth/reset_password/:token` | Token-bound password reset                                 |
| `GET /api/auth/meta`                   | Authentication metadata                                    |
| `GET /api/system_db`                   | Unauthenticated application health response                |
| `POST /api/invite/accept/:token`       | Invitation-token acceptance                                |
| `GET /api/invite/check/:token`         | Invitation-token validation                                |
| `POST /api/banking/plaid/webhooks`     | Plaid signature/JWT verification before webhook processing |
| `POST /api/webhooks/stripe/`           | Stripe signature verification before webhook processing    |

All other application endpoints (`/api/organizations`, `/api/accounts`,
`/api/invoices`, and so on) require native authentication. “Public” here means
exempt from the application JWT/API-key guard; the intended production network
path still sits behind the separately verified Cloudflare Access policy. Plaid
and Stripe remain disabled unless their exact production integration and edge
delivery path are deliberately configured and accepted.

### 5.3 JWT Configuration

JWT tokens are configured in `packages/server/src/modules/Auth/Auth.module.ts:58-65`:

| Parameter | Value                              |
| --------- | ---------------------------------- |
| Algorithm | HS384                              |
| Expiry    | 1 day                              |
| Secret    | From `APP_JWT_SECRET` env variable |

---

## 6. Session Behavior

### 6.1 Token Lifecycle

| Event            | Behavior                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| Sign in          | Server issues a signed JWT with 1-day expiry                              |
| Token storage    | Stored client-side (webapp in memory/localStorage)                        |
| Token refresh    | Not implemented; re-login required after expiry                           |
| Token validation | `JwtAuthGuard` validates signature, expiry, and algorithm on each request |
| Logout           | Client-side token discard; no server-side invalidation                    |

### 6.2 Session Limitations

- **No server-side session store**: JWTs are self-contained; no Redis session tracking
- **No token revocation**: Tokens remain valid until natural expiry
- **No refresh token rotation**: Single JWT per login session

### 6.3 Recommendations for Production

For production deployment, consider:

- Reducing JWT expiry to 15-30 minutes with refresh token mechanism
- Implementing a token blacklist (Redis) for forced logout
- Adding device/session fingerprinting

---

## 7. Secret Hygiene

### 7.1 Current Secrets

| Secret                         | Location            | Risk                                                         |
| ------------------------------ | ------------------- | ------------------------------------------------------------ |
| `APP_JWT_SECRET`               | `.env` (gitignored) | Must be random and decode to at least 64 bytes in production |
| Database passwords             | `.env` (gitignored) | Must be rotated before production                            |
| API keys (Plaid, Stripe, etc.) | `.env` (gitignored) | All placeholder values only                                  |

### 7.2 Hygiene Rules

- `.env` and `.env.*` are in `.gitignore` (verified)
- `.env.example` files contain only placeholder/example values (verified)
- No secrets appear in tracked source files (verified)
- No real LLC data, production credentials, or API keys in workspace (verified)

### 7.3 Pre-Production Checklist

- [ ] Generate a new `APP_JWT_SECRET` whose decoded value is at least 64 random bytes
- [ ] Generate new database passwords
- [ ] Remove any test/fake accounts
- [ ] Enable `SIGNUP_EMAIL_CONFIRMATION=true` if email delivery is configured
- [ ] Review and rotate all third-party API keys (Plaid, Stripe, LemonSqueezy, S3, PostHog)
- [ ] Verify the pre-existing Cloudflare Access/Tunnel/DNS/cloudflared service and one active connector without mutating them
- [ ] Resolve and prove first-owner onboarding before a truly fresh deployment
- [x] Production dependency audit triaged and remediated to 45 findings: 9 low,
      36 moderate, 0 high, and 0 critical

---

## 8. SSO / MFA Follow-up

### 8.1 Current State

EasyFire Bookkeeping uses **BigCapital native local authentication only**. There is no SSO, OAuth, SAML, or MFA implementation in the current codebase.

The following are **not launch blockers** for the private single-user deployment:

| Feature                           | Status                        | Rationale                                                   |
| --------------------------------- | ----------------------------- | ----------------------------------------------------------- |
| OAuth/OIDC (Google, GitHub, etc.) | Not implemented               | Single-user private launch does not require federated login |
| SAML 2.0 (enterprise SSO)         | Not implemented               | Not needed for single-tenant private use                    |
| MFA (TOTP, SMS, WebAuthn)         | Not implemented               | Acceptable risk for private local deployment                |
| Clerk integration                 | Not implemented               | Explicitly deferred per launch requirements                 |
| Password policy enforcement       | Minimal (no complexity rules) | Mitigated by single-user private access                     |

### 8.2 Integration Points for Future SSO/MFA

If SSO or MFA is needed post-launch, the following integration points exist:

| Integration point          | File                                                              | Description                                              |
| -------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| Auth strategy registration | `packages/server/src/modules/Auth/Auth.module.ts`                 | Additional Passport strategies can be registered         |
| Guard chain                | `packages/server/src/modules/Auth/Auth.module.ts:101-110`         | New guards can be added to the global guard chain        |
| Signin service             | `packages/server/src/modules/Auth/commands/AuthSignin.service.ts` | Can be extended for MFA challenge/response               |
| User model                 | `SystemUser` model                                                | Can be extended with SSO provider IDs, MFA secret fields |
| Webapp login               | `packages/webapp/src/containers/Authentication/`                  | UI can be extended for SSO buttons, MFA code entry       |

### 8.3 Recommended Approach (when needed)

1. Add Passport strategies for desired providers (OAuth2, SAML)
2. Implement a TOTP-based MFA flow (RFC 6238)
3. Extend `SystemUser` with `mfaSecret`, `mfaEnabled`, `ssoProvider`, `ssoSubject` fields
4. Add MFA enforcement to the guard chain (after JWT validation, before route access)
5. Keep Clerk as an optional alternative, not a required dependency

---

## 9. Security Configuration Checklist

### 9.1 Implemented (Current)

- [x] Signup disabled (`SIGNUP_DISABLED=true`)
- [x] No hardcoded default credentials
- [x] JWT-based authentication on all non-public routes
- [x] Global auth guard (`MixedAuthGuard`) intercepts all requests
- [x] `.env` files gitignored, no secrets in tracked files
- [x] `.env.example` updated with secure defaults
- [x] Webapp UI hides signup link when signup is disabled

### 9.2 Verified (Code Audit)

- [x] `AuthSignup.service.ts:111-141` -- Signup restriction validation works correctly
- [x] `jwt.guard.ts:18-28` -- JWT guard skips public routes, enforces all others
- [x] `MixedAuth.guard.ts:14-22` -- Routes to JWT or API key auth
- [x] `Auth.controller.ts:37` -- Auth routes correctly marked `@PublicRoute()`
- [x] No CLI user creation commands exist
- [x] Disposable built-server auth proof parses the real sign-in JWT, requires
      HS384, rejects an HS384 forgery signed with the retired `123123` secret,
      and rejects an HS256 wrong-algorithm forgery signed with the configured
      secret (`b37426f03a8841d9923b853db5f40a08`)

### 9.3 For Production Deployment

- [ ] Rotate `APP_JWT_SECRET`
- [ ] Rotate all database passwords
- [ ] Verify HTTPS and owner-only policy through the pre-existing Cloudflare edge
- [ ] Prove a supported first-owner onboarding path or reconcile an existing valid owner
- [ ] Enable email verification (`SIGNUP_EMAIL_CONFIRMATION=true`)
- [ ] Configure mail delivery (SMTP credentials)
- [ ] Implement token refresh mechanism
- [ ] Review and tune the existing global/auth-specific rate limits for the live
      owner traffic profile
- [ ] Implement audit logging for signin attempts

---

## 10. Residual Risks

| Risk                                                               | Severity | Mitigation                                                                                                                      |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| JWT secret exposure in `.env`                                      | High     | `.env` is gitignored; rotate before production                                                                                  |
| No password complexity enforcement                                 | Medium   | Use strong passwords; mitigate with limited access                                                                              |
| No account lockout after failed attempts                           | Medium   | Rate limiting on auth endpoints (`THROTTLE_AUTH_*`)                                                                             |
| No MFA for admin account                                           | Medium   | Single-user private deployment; add MFA post-launch                                                                             |
| No session revocation capability                                   | Low      | 1-day JWT expiry limits exposure window                                                                                         |
| System database accessible if DB credentials leak                  | High     | MariaDB has no host-published port and is reachable only by authorized services on the private Compose network                  |
| Internal API listener is reachable on the Compose network          | Medium   | Server has no host-published port; Envoy alone publishes `127.0.0.1:${PUBLIC_PROXY_PORT}:80`; verify zero other published ports |
| No supported first-owner onboarding on a fresh database            | High     | Stop before fresh production; separately design and prove onboarding while signup remains locked                                |
| Production dependency audit retains 36 moderate and 9 low findings | Medium   | No high or critical findings remain; keep the residual advisories disclosed and review them during future dependency refreshes  |

---

## 11. File References

| Concern                         | File                                                                  | Lines   |
| ------------------------------- | --------------------------------------------------------------------- | ------- |
| Signup control env vars         | `.env.example`                                                        | 43-48   |
| Signup restriction config       | `packages/server/src/common/config/signup-restrictions.ts`            | 1-11    |
| Signup validation logic         | `packages/server/src/modules/Auth/commands/AuthSignup.service.ts`     | 111-141 |
| JWT guard                       | `packages/server/src/modules/Auth/guards/jwt.guard.ts`                | 10-28   |
| Mixed auth guard                | `packages/server/src/modules/Auth/api-key/MixedAuth.guard.ts`         | 8-23    |
| Verified user guard             | `packages/server/src/modules/Auth/guards/EnsureUserVerified.guard.ts` | 17-49   |
| Auth meta endpoint              | `packages/server/src/modules/Auth/queries/GetAuthMeta.service.ts`     | 12-16   |
| Auth controller (public routes) | `packages/server/src/modules/Auth/Auth.controller.ts`                 | 34-133  |
| Auth module (global guards)     | `packages/server/src/modules/Auth/Auth.module.ts`                     | 53-113  |
| Webapp login (signup link)      | `packages/webapp/src/containers/Authentication/Login.tsx`             | 59-79   |
| Auth meta boot (signupDisabled) | `packages/webapp/src/containers/Authentication/AuthMetaBoot.tsx`      | 12-27   |
| Local boot evidence             | `docs/easyfire/LOCAL_BOOT.md`                                         | 1-248   |
