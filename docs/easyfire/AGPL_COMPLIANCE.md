# EasyFire Bookkeeping AGPL-3.0 Compliance Record

**Owner:** EasyFire

**Updated:** 2026-07-20

**Status:** Corresponding-source support is implemented. Publication is proven
only by anonymous exact-commit readback from the public repository; deployed
source-link verification remains a separate live-acceptance check.

This is an implementation-oriented compliance record, not legal advice.

## License and upstream

- License: GNU Affero General Public License version 3, preserved in the root
  LICENSE file.
- Upstream project: https://github.com/bigcapitalhq/bigcapital
- Upstream base commit:
  8c90ca328ec59dd772de3b385531eb386de11ac8
- EasyFire corresponding source:
  https://github.com/EasyFire101/easyfire-bookkeeping
- EasyFire modifications began: 2026-07-09.
- Current ownership and runtime truth:
  docs/easyfire/CURRENT_STATE.md.

Original Bigcapital Git history, contributors, copyright notices, package names,
and license text are preserved. The EasyFire repository keeps the full upstream
history rather than an orphan, squash, or source-only snapshot.

## Network deployment

The network service is intended to be hosted at bookkeeping.easyfire.fyi for
one owner behind pre-existing Cloudflare Access and native application
authentication. Publishing this candidate does not itself prove deployment,
runtime reconciliation, or authenticated live acceptance. When users interact
with the modified program over a network, the application provides a visible
Source code (AGPL-3.0) link to the EasyFire repository.

The source implements that link on:

- authentication and account-recovery screens;
- initial setup;
- the signed-in dashboard shell;
- the payment portal.

The public repository must be anonymously readable and retain the exact
deployed revision through an immutable commit and release tag. Exact public
readback, deployed revision reconciliation, and authenticated source-link
acceptance are recorded externally; this containing commit cannot prove its own
publication.

## EasyFire modifications

The corresponding source includes the complete modified program and the
scripts/configuration needed to build and operate it, including:

- EasyFire Bookkeeping display name, metadata, manifest, and API title;
- single-owner authentication and signup restrictions;
- MariaDB defaults, tenant naming, startup behavior, and branch/event fixes;
- production Docker Compose topology and health checks;
- Windows production action, journal, Compose restart policy, retired startup
  helper, daily backup, restore, validation, and rollback controls;
- Cloudflare Tunnel and Access templates;
- deterministic toolchain, dependency, image, and download pins;
- visible source-disclosure UI;
- synthetic workflow tests and sanitized evidence;
- EasyFire ownership, runtime, recovery, and release documentation.

Use the accepted release commit and its diff against the upstream base for the
authoritative file-level modification inventory. A hand-maintained list in this
document is explanatory and does not replace Git history.

## Corresponding-source boundary

Published corresponding source includes:

- all modified application and shared-package source;
- Dockerfiles, Compose files, workspace manifests, and lockfile;
- production and validation scripts;
- safe environment examples and Cloudflare templates;
- tests, synthetic fixtures, and build instructions;
- the unmodified AGPL-3.0 license and upstream attribution.

The public repository intentionally excludes material that is not source code
and must remain private:

- real .env files and credentials;
- Cloudflare tokens and account identifiers;
- database contents, attachments, exports, and real financial records;
- production journals, backups, release archives, logs, and restore scratch
  data;
- owner email addresses, passwords, session tokens, and provider secrets.

Safe placeholder examples remain in Git so a user can build the source without
receiving EasyFire private data.

## Modified-source notices

The README prominently identifies this as an EasyFire modified fork, records
the modification date and upstream base, links the public corresponding source,
and preserves upstream attribution below the notice. Application surfaces use
one shared source URL constant to avoid drift.

Production release records must add:

- accepted EasyFire commit;
- public release tag;
- release archive SHA-256;
- immutable image tag;
- deployed production journal action ID;
- anonymous source-URL verification date.

These values belong in HANDOFF.md and the release record once known; they must
not be guessed in advance.

## Verification checklist

- [x] Root AGPL-3.0 license text is present.
- [x] Bigcapital upstream project and base commit are recorded.
- [x] Original history, contributors, and notices are preserved.
- [x] EasyFire modification notice and date are prominent in README.md.
- [x] Candidate source links use the EasyFire-owned public URL rather than only
      the Bigcapital upstream URL.
- [x] Secrets, journals, backups, databases, logs, and user records are excluded
      from Git.
- [ ] External release evidence confirms Forgejo accepted source at the exact
      released commit.
- [ ] External release evidence confirms anonymous GitHub readback of the same
      commit.
- [ ] The exact deployed revision is available by immutable tag or commit.
- [ ] Authenticated live acceptance confirms the source link on deployed
      network-user surfaces.
- [ ] The completed production journal is reconciled to the published release.

## References

- GNU AGPL-3.0: https://www.gnu.org/licenses/agpl-3.0.html
- Bigcapital upstream: https://github.com/bigcapitalhq/bigcapital
- EasyFire source: https://github.com/EasyFire101/easyfire-bookkeeping
- Current state: ./CURRENT_STATE.md
- Production runbook: ./PRODUCTION_RUNBOOK.md
