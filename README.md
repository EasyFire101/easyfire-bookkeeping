## EasyFire Bookkeeping fork

This repository contains the EasyFire Bookkeeping modifications to
[Bigcapital](https://github.com/bigcapitalhq/bigcapital), based on upstream
commit `8c90ca328ec59dd772de3b385531eb386de11ac8`. EasyFire modifications began
on 2026-07-09 and include single-owner branding, authentication restrictions,
Windows/Docker production operations, backup and restore controls, and visible
network-user source disclosure.

EasyFire Bookkeeping remains licensed under
[GNU AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html). The public
corresponding-source location is
[EasyFire101/easyfire-bookkeeping](https://github.com/EasyFire101/easyfire-bookkeeping),
and private accepted source is the owner-controlled EasyFire Forgejo repository.
Publication is established only by exact remote readback of the same release
commit at both destinations. Neither a URL nor this checkout proves deployment
or authenticated live acceptance.
Original Bigcapital history, copyright, contributors, and license text are
preserved below. See [the EasyFire compliance record](docs/easyfire/AGPL_COMPLIANCE.md)
for the modification and source-availability boundary.

The current production controller is fresh-install-only. Existing MariaDB data
requires a separate blue/green logical migration; Cloudflare and cloudflared
resources are pre-existing infrastructure that the controller verifies but
never modifies; and automated owner bootstrap is retired. See [current
state](docs/easyfire/CURRENT_STATE.md) and the
[production runbook](docs/easyfire/PRODUCTION_RUNBOOK.md) before operational
work.

The direct-takeover candidate now binds every controller invocation to exact
hashes for the four executable controller files, journals built Docker image
IDs rather than trusting mutable tags, publishes the generated environment
through a hash-bound candidate, starts the one-shot migration container at
most once with a bounded timeout, preserves even partially created durable
volumes on rollback, and verifies exact task, edge, port, and foreign-volume
consumer identity. Daily backups run only through the fifth
`ScheduledBackup` controller stage from the sealed installed controller using
canonical Windows PowerShell and the deployment-owner SID bound into the action
journal. Each baseline, emergency, or scheduled backup is a crash-resumable
recovery unit: compressed dump, SHA-256 sidecar, and authority-bound metadata,
followed by an isolated restore check.

The frozen offline dependency install, server typecheck, dependency
compatibility suite, and full application build pass on this candidate. The
complete production audit reports 45 advisories: 9 low, 36 moderate, 0 high,
and 0 critical. Exact disposable Docker proof and independent-review evidence
are recorded in [current state](docs/easyfire/CURRENT_STATE.md) and
[HANDOFF.md](./HANDOFF.md); those records do not imply a reconciled running
service. A truly fresh installation also has no supported way to create its
first owner login, so owner onboarding must be designed and proven separately
before such an installation can be usable.

## EasyFire project foundation

- Operating profile and runtime truth: [PROJECT_PROFILE.json](./PROJECT_PROFILE.json)
- Durable decisions and dependency evidence: [PROJECT_LOG.md](./PROJECT_LOG.md)
- Current continuation state: [HANDOFF.md](./HANDOFF.md)
- Promotion gates and recovery boundaries: [FEATURE_READINESS.md](./FEATURE_READINESS.md)
- Foundation version: 1.7.0
- Deterministic install: `corepack pnpm install --frozen-lockfile`

---

<p align="center">
  <p align="center">
    <a href="https://bigcapital.app" target="_blank">
      <img src="https://raw.githubusercontent.com/abouolia/blog/main/public/bigcapital.svg" alt="Bigcapital" width="280" height="75">
    </a>
  </p>
  <p align="center">
    Simple, smart online accounting software for small and medium businesses.
  </p>

  <p align="center">
    <a href="https://github.com/bigcapitalhq/bigcapital/commits/develop">
      <img src="https://img.shields.io/github/commit-activity/m/bigcapitalhq/bigcapital/develop" />
    </a>
    <a href="https://hub.docker.com/u/bigcapitalhq">
      <img src="https://img.shields.io/docker/pulls/bigcapitalhq/webapp" />
    </a>
    <a href="https://discord.com/invite/c8nPBJafeb">
      <img src="https://img.shields.io/discord/1066514716752625725?label=Discord" alt="" />
    </a>
    <a href="https://github.com/bigcapitalhq/bigcapital/graphs/contributors">
      <img src="https://img.shields.io/github/contributors/bigcapitalhq/bigcapital" alt="" />
    </a>
    <a href="https://github.com/bigcapitalhq/bigcapital/blob/develop/LICENSE">
      <img src="https://img.shields.io/github/license/bigcapitalhq/bigcapital" alt="" />
    </a>
    <a href="https://twitter.com/bigcapitalhq"> 
      <img src="https://img.shields.io/twitter/follow/bigcapitalhq?style=social" alt="twitter" />
    </a>
  </p>

  <p align="center">
    <a href="https://my.bigcapital.app">Bigcapital Cloud</a>
  </p>
</p>

# What's Bigcapital?

Bigcapital is a smart and open-source accounting and inventory software, Bigcapital keeps all business finances in right place and automates accounting processes to give the business powerful and intelligent financial statements and reports to help in making decisions.

<p align="center">
  <img src="https://raw.githubusercontent.com/abouolia/blog/main/public/screenshot-2.png" width="270">
  <img src="https://raw.githubusercontent.com/abouolia/blog/main/public/screenshot-1.png" width="270">
  <img src="https://raw.githubusercontent.com/abouolia/blog/main/public/screenshot-3.png" width="270">
</p>

# Getting Started

We've got serveral options on dev and prod depending on your need to get started quickly with Bigcapital.

## Self-hosted

Bigcapital is available open-source under AGPL license. You can host it on your own servers using Docker.

### Docker

To get started with self-hosted with Docker and Docker Compose, take a look at the [Docker guide](https://docs.bigcapital.app/deployment/docker).

## Development

### Local Setup

To get started locally, we have a [guide to help you](https://github.com/bigcapitalhq/bigcapital/blob/develop/CONTRIBUTING.md).

### Gitpod

- Click the Gitpod button below to open this project in development mode.
- This will open and configure the workspace in your browser with all the necessary dependencies.

[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/new/#https://github.com/bigcapitalhq/bigcapital)

## Headless Accounting

You can integrate Bigcapital API with your system to organize your transactions in double-entry system to get the best financial reports.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://www.postman.com/bigcapital/workspace/bigcapital-api)

# Resources

- [Documentation](https://docs.bigcapital.app/) - Learn how to use.
- [API Reference](https://docs.bigcapital.app/api-reference) - API reference docs
- [Contribution](https://github.com/bigcapitalhq/bigcapital/blob/develop/CONTRIBUTING.md) - Welcome to any contributions.
- [Discord](https://discord.com/invite/c8nPBJafeb) - Ask for help.
- [Bug Tracker](https://github.com/bigcapitalhq/bigcapital/issues) - Notify us new bugs.

# Changelog

Please see [Releases](https://github.com/bigcapitalhq/bigcapital/releases) for more information what has changed recently.

# Contact us

Meet our sales team for any commercial inquiries.

<a target="_blank" href="https://cal.com/ahmed-bouhuolia-ekk3ph/30min"><img src="https://cal.com/book-with-cal-dark.svg" alt="Book us with Cal.com"></a>

# Recognition

<a href="https://news.ycombinator.com/item?id=36118990">
  <img
    style="width: 250px; height: 54px;" width="250" height="54"
    alt="Featured on Hacker News"
    src="https://hackernews-badge.vercel.app/api?id=36118990"
  />
</a>

# Contributors

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/abouolia"><img src="https://avatars.githubusercontent.com/u/2197422?v=4?s=100" width="100px;" alt="Ahmed Bouhuolia"/><br /><sub><b>Ahmed Bouhuolia</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/commits?author=abouolia" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://ameir.net"><img src="https://avatars.githubusercontent.com/u/374330?v=4?s=100" width="100px;" alt="Ameir Abdeldayem"/><br /><sub><b>Ameir Abdeldayem</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/issues?q=author%3Aameir" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/elforjani13"><img src="https://avatars.githubusercontent.com/u/39470382?v=4?s=100" width="100px;" alt="ElforJani13"/><br /><sub><b>ElforJani13</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/commits?author=elforjani13" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://scheibling.se"><img src="https://avatars.githubusercontent.com/u/24367830?v=4?s=100" width="100px;" alt="Lars Scheibling"/><br /><sub><b>Lars Scheibling</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/issues?q=author%3Ascheibling" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/suhaibaffan"><img src="https://avatars.githubusercontent.com/u/18115937?v=4?s=100" width="100px;" alt="Suhaib Affan"/><br /><sub><b>Suhaib Affan</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/commits?author=suhaibaffan" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/KalliopiPliogka"><img src="https://avatars.githubusercontent.com/u/81677549?v=4?s=100" width="100px;" alt="Kalliopi Pliogka"/><br /><sub><b>Kalliopi Pliogka</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/issues?q=author%3AKalliopiPliogka" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://me.kochie.io"><img src="https://avatars.githubusercontent.com/u/10809884?v=4?s=100" width="100px;" alt="Robert Koch"/><br /><sub><b>Robert Koch</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/commits?author=kochie" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="http://cschuijt.nl"><img src="https://avatars.githubusercontent.com/u/5460015?v=4?s=100" width="100px;" alt="Casper Schuijt"/><br /><sub><b>Casper Schuijt</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/issues?q=author%3Acschuijt" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/ANasouf"><img src="https://avatars.githubusercontent.com/u/19536487?v=4?s=100" width="100px;" alt="ANasouf"/><br /><sub><b>ANasouf</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/commits?author=ANasouf" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://ragnarlaud.dev"><img src="https://avatars.githubusercontent.com/u/3042904?v=4?s=100" width="100px;" alt="Ragnar Laud"/><br /><sub><b>Ragnar Laud</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/issues?q=author%3Axprnio" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/asenawritescode"><img src="https://avatars.githubusercontent.com/u/67445192?v=4?s=100" width="100px;" alt="Asena"/><br /><sub><b>Asena</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/issues?q=author%3Aasenawritescode" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://snyder.tech"><img src="https://avatars.githubusercontent.com/u/707567?v=4?s=100" width="100px;" alt="Ben Snyder"/><br /><sub><b>Ben Snyder</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/commits?author=benpsnyder" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://vederis.id"><img src="https://avatars.githubusercontent.com/u/13505006?v=4?s=100" width="100px;" alt="Vederis Leunardus"/><br /><sub><b>Vederis Leunardus</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/commits?author=cloudsbird" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://www.pivoten.com"><img src="https://avatars.githubusercontent.com/u/104120598?v=4?s=100" width="100px;" alt="Chris Cantrell"/><br /><sub><b>Chris Cantrell</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/issues?q=author%3Accantrell72" title="Bug reports">🐛</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/oleynikd"><img src="https://avatars.githubusercontent.com/u/3976868?v=4?s=100" width="100px;" alt="Denis"/><br /><sub><b>Denis</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/issues?q=author%3Aoleynikd" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://myself.vercel.app/"><img src="https://avatars.githubusercontent.com/u/42431274?v=4?s=100" width="100px;" alt="Sachin Mittal"/><br /><sub><b>Sachin Mittal</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/issues?q=author%3Amittalsam98" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://www.camilooviedo.com/"><img src="https://avatars.githubusercontent.com/u/64604272?v=4?s=100" width="100px;" alt="Camilo Oviedo"/><br /><sub><b>Camilo Oviedo</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/commits?author=Champetaman" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://nklmantey.com/"><img src="https://avatars.githubusercontent.com/u/90279429?v=4?s=100" width="100px;" alt="Mantey"/><br /><sub><b>Mantey</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/issues?q=author%3Anklmantey" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://d.sb/"><img src="https://avatars.githubusercontent.com/u/91933?v=4?s=100" width="100px;" alt="Daniel Lo Nigro"/><br /><sub><b>Daniel Lo Nigro</b></sub></a><br /><a href="https://github.com/bigcapitalhq/bigcapital/issues?q=author%3ADaniel15" title="Bug reports">🐛</a> <a href="https://github.com/bigcapitalhq/bigcapital/commits?author=Daniel15" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind welcome!
