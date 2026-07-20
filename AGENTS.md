# EasyFire Bookkeeping Agent Instructions

## Project Purpose

- Private, single-owner bookkeeping application based on Bigcapital under AGPL-3.0.
- Treat real financial records, identity data, attachments, and production credentials as sensitive.
- Agent Foundry is historical provenance only; this repository and its current handoff own the project.

## Local And Remote Locations

- Local project root: use the current repository checkout; machine-specific paths stay outside published source.
- Accepted-source remote: `easyfire-forgejo` for the private owner-controlled Forgejo repository `jonny-admin/easyfire-bookkeeping`.
- Public AGPL mirror: `easyfire-github` at `https://github.com/EasyFire101/easyfire-bookkeeping.git`
- Upstream-only remote: `origin` at `https://github.com/bigcapitalhq/bigcapital.git`; never push EasyFire changes there.
- Default branch: `main`

## Commands

- Install: `corepack pnpm install --frozen-lockfile`
- Run locally: `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\agent-foundry-dev-boot.ps1` (legacy-named local compatibility helper; it does not invoke Agent Foundry)
- Focused release test: `node --test .\\tests\\easyfire-release-readiness.test.mjs`
- Static production validation: `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\production\\validate.ps1`
- Foundation check: `node scripts/project-foundation-check.mjs`
- Source-size guard: `node scripts/source-size-guard.mjs --changed`
- Build: `pnpm run typecheck`, then `pnpm run build`
- Production deploy or rollback: only the immutable archive-and-hash `deploy\\windows\\production-action.ps1` flow with a unique action ID and schema-2 journal. The controller is fresh-install-only. At a new ActionId, any historical, project-labeled, or action-derived MariaDB/Redis volume or prior action authority requires separate migration/recovery review. A resume may see only the exact two volumes bound to the same compatible schema-2 journal phase. Existing MariaDB data requires a blue/green logical migration.
- Runtime check: use the completed Newsec production journal's action ID with the production-action `Postcheck` stage; never guess an action ID or treat the local checkout as runtime truth.
- Cloudflare Access, Tunnel, DNS, the cloudflared binary, and its Windows service are pre-existing verify-only infrastructure for this controller. Edge repair is a separate scope.
- Automated production owner bootstrap is retired and unavailable. Do not use `scripts\\production\\bootstrap-owner.ps1` as a release step.
- Production startup relies on Compose `restart: unless-stopped`; the startup scheduled-task helper is retired and must fail closed. The only controller-managed scheduled task is the exact daily backup task.

## Project Profile

- Read `PROJECT_PROFILE.json` before substantial work and keep its mode fields current.
- Scale guardrails to `controlProfile`, `executionMode`, and `readinessLevel`: personal/local one-shot or interactive work stays compact; unattended, shared/packaged, and hosted/public boundaries add only their relevant controls.
- When the real runtime is not the local checkout, prove what is actually running before calling work shipped.
- Treat the profile's operating model as the compact source for validation, runtime truth, mutation approval, artifact policy, and handoff expectations.

## Foundation Choices

- Prefer maintained, license-compatible, locally editable open-source foundations when they fit.
- Record chosen frameworks, libraries, templates, and major tools in `PROJECT_LOG.md`.
- When a proprietary, hosted, closed-source, or hard-to-edit foundation is chosen, log the reason, data touched, and replacement path.

## Working Rules

- Inspect existing files before editing.
- Keep changes scoped to the requested lane.
- Do not overwrite unrelated local work.
- Use narrow staging paths; avoid broad `git add .` when unrelated files exist.
- Local commits are allowed after validation for completed durable work.
- Do not create or change a remote, push, or merge without explicit approval or a standing project-specific instruction that clearly authorizes it.
- Preserve full Bigcapital upstream history and attribution. Do not squash, orphan, force-push, or publish EasyFire changes to the upstream-only `origin` remote.

## Parallel Agent Rules

- Prefer a branch or worktree per meaningful lane.
- Record ownership in `HANDOFF.md` when multiple agents may touch the project.
- Before merging older work, fetch the accepted-source ref recorded in `PROJECT_PROFILE.json` at `sourceOfTruth.code.acceptedRef`, then rebase or merge instead of force-pushing.
- Stop for true overlaps, failing checks, auth/network blockers, or destructive data decisions.

- This project is scaffolded as single-agent by default. Upgrade with the foundation audit before running parallel lanes.

## Data And Secrets

- Keep `.env`, credentials, tokens, signing keys, local databases, logs with private payloads, and generated artifacts out of Git.
- Maintain `.env.example` with safe placeholders when configuration is needed.
- Store editable user data in durable backed-up storage, not only source constants, unless it is intentionally seed/default data.
- Keep production journals, releases, backups, restore scratch space, and Cloudflare/service credentials outside Git.

## Security, Privacy, And Reproducibility

- Record trust boundaries, authentication/authorization, input validation, abuse cases, sensitive data, and dependency risk in `FEATURE_READINESS.md` before externally exposed or data-sensitive work.
- After selecting a stack, pin the runtime/toolchain, commit the ecosystem lockfile when supported, and record a deterministic install command.
- For single-owner private/local source, secret hygiene and a verified recovery path may be sufficient. Propose protected branches, required checks, dependency updates, or scanners when sharing, exposure, data, or consequence warrants them; repository-setting changes remain approval-gated.
- Apply the operating concerns recorded in `PROJECT_PROFILE.json`. One-shot automations need explicit inputs/authority, a timeout, safe reruns, focused status, and recovery; scheduled jobs and services additionally need idempotency, bounded retries, health checks, structured logs, and partial-failure recovery.

## Impact, Contracts, And Runtime

- For durable projects, maintain an impact map or short project-log rule that maps changed paths to focused tests, runtime/deploy questions, and data-risk notes.
- Run `node scripts/source-size-guard.mjs --changed` before handoff when relevant files changed. Warnings are advisory. For a blocker, split the file or record an exact path-scoped policy threshold plus its path, line count/severity, why splitting is disproportionate, containment/tests, and a re-review trigger.
- Direct typed code plus a focused test is sufficient for one local consumer. Add a registry, adapter, or shared contract only across consumers, processes, providers, durable compatibility, dynamic discovery, or external/untrusted boundaries.
- Prefer a local replay or fake-payload harness before live verification when a bug could otherwise first appear in a live chat/server, production, a provider, a deployment, or real user data.
- Record which state mutations require explicit approval, including deletes, migrations, sends/posts, deploys/restarts, scheduled-task changes, paid provider calls, and provider configuration changes.
- When adopting this project into another agent system, run the foundation audit and review `Guardrail Capability Readiness` before changing code.
- Before release, run the frozen install, format, lint, typecheck, build, focused tests, fake-data E2E, disposable Docker, and backup/restore proof recorded in `HANDOFF.md`.

## Artifacts And Logs

- Keep bulky diagnostics, screenshots, generated media, run reports, provider payloads, and local logs ignored unless they are sanitized fixtures needed for tests.
- Summarize or rotate long-running logs and ledgers instead of repeatedly appending low-value history.
- Search large ledgers or archived docs with targeted commands instead of loading them in full during routine work.

## Done Means

- Relevant validation passed or the blocker is named.
- Durable work is locally committed when the project policy permits; publication status and any required approval are explicit.
- Handoff states changed files, commands run, runtime/drift status when relevant, state mutations performed or avoided, and remaining risks.
