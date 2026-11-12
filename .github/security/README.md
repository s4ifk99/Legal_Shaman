# Daily security scan

This workflow scans the latest default branch code and the public website. It does not fix, commit, or deploy. It does not send source code or user data to an external AI service.

The scanned app is the Next.js 16 project in `web/`, installed with npm and Node 22 (`web/package-lock.json`). Vercel hosts it with root directory `web` (`web/vercel.json`). The public site used by the baseline scan is `https://www.legalshaman.com`. A Python requirements file, `scripts/exa/requirements-exa.txt`, is included in dependency scanning. The repository already has scheduled ingest and sync workflows. It did not already have Dependabot, CodeQL, or a security scan workflow.

Scheduled runs start only after this file is on the default branch. Use **Run workflow** to start it manually.

## Schedule

The intended time is **02:00 Europe/London**, including British Summer Time.

GitHub Actions cron accepts UTC only, and a run can start late. The workflow therefore registers two slots:

- `0 1 * * *` (01:00 UTC), which is 02:00 London during British Summer Time
- `0 2 * * *` (02:00 UTC), which is 02:00 London during Greenwich Mean Time

A gate job runs the slot that matches 02:00 London on that civil date. The other slot records **skipped** and the scan job does not start. GitHub shows that scan job as Skipped. A green workflow run with a skipped scan job is not a scan and it is not a clean result.

If GitHub starts the matching slot late, the scan still runs while London time is 02:00 through 05:59. After 05:59 London time that day's scheduled scan is skipped. On the March and October clock changes, unit tests expect a single run rather than two.

GitHub can also disable scheduled workflows after 60 days without a repository update.

## What you must configure

Create a long random passphrase and store it as the Actions secret `SECURITY_SCAN_REPORT_KEY` (at least 16 characters). For example:

```bash
openssl rand -base64 32
```

Add it under Settings, Secrets and variables, Actions. Do not commit it.

The repository is public. Anyone signed in to GitHub can download artifacts from a public repository, so the job encrypts the report with AES-256-GCM before upload and refuses to upload plaintext. Artifact retention is 14 days.

No other secret is required. The ZAP target is read from the repository, not from an environment secret.

Decrypt a downloaded artifact locally:

```bash
SECURITY_SCAN_REPORT_KEY='your secret' \
  node .github/security/scripts/decrypt-report.mjs security-report-YYYY-MM-DD.bin ./report
```

## ZAP target

The baseline scan runs only when these four values are the same public `https` URL:

- `NEXT_PUBLIC_SITE_URL` in `web/.env.example`
- the `resolveSiteUrl()` fallback in `web/lib/email/config.ts`
- the `resolveSiteUrl()` fallback in `web/lib/email/triage-summary-template.ts`
- `metadataBase` in `web/app/layout.tsx`

If they disagree, or the value is not a public https URL, ZAP does not run and the workflow fails as incomplete. The scan will not guess a target.

Before the baseline starts, the job requests that URL. The baseline runs only when the response is HTTP 2xx and the final host is the configured site. A redirect between `www` and the apex host is accepted. Any other status, including a Vercel `DEPLOYMENT_DISABLED` response, skips the baseline and fails the workflow as incomplete. An error page is not recorded as a clean website scan.

## Scanners

Versions are pinned in `versions.env`. Checksums and image digests were reconfirmed on 12 November 2026. Gitleaks 8.30.1 is the current release. osv-scanner 2.7.1, published 9 November 2026, is still the current release. Semgrep 1.185.0, published 10 November 2026, is the newest numbered image tag. Its index digest was reconfirmed on 12 November 2026. Docker Hub `latest` points at the older 1.184.0 digest, so the workflow pins 1.185.0 by digest. The ZAP `stable` and `latest` index digests are the same and unchanged since 10 November 2026. That image tracks the latest stable ZAP release (2.17.0, still the current upstream release on 12 November 2026) and refreshes add-ons at image build time. An older ZAP index from 29 October 2026 can still be fetched by digest. It is not the `stable` tag. On 11 November 2026, `zap.sh -version` and the baseline report `@version` in this same image digest were both ZAP 2.17.0.

| Scanner | Role |
| --- | --- |
| npm audit | Vulnerabilities in `web/package-lock.json`. npm audit sends package names and versions to the npm advisory service. It does not upload source code. No `npm audit fix`. |
| osv-scanner 2.7.1 | Same lockfile, plus `scripts/exa/requirements-exa.txt`. Package names and versions are sent to the OSV / deps.dev services. Source code is not. No `osv-scanner fix`. |
| gitleaks 8.30.1 | Working tree only, with `--redact=100`. Git history is not scanned. `data/`, `web/data/`, and files over 2 MB are skipped. |
| Application checks | Local Node checks for authentication, authorisation, exposed keys, injection, XSS, insecure configuration, and sensitive user data. |
| Semgrep 1.185.0 | Local `semgrep scan` in a pinned image. Metrics and Semgrep App are off. `semgrep ci` is not used. Community rule packs, including GitHub Actions, are downloaded. Source is mounted read only. |
| OWASP ZAP baseline | Unauthenticated passive baseline of the public site. The pinned index digest was still the `stable` tag on 12 November 2026. On 11 November 2026, `zap.sh -version` and the baseline report `@version` in that same image were both ZAP 2.17.0. The job uses `zap-baseline.py --autooff` so the spider honours `spider.postform=false`. It does not POST forms, log in, or run an active attack policy. Add-ons are not updated at runtime (`-silent`), and ZAP telemetry is off. Spider cap 5 minutes, depth 4, passive scan cap 20 minutes. A traditional spider can still request GET URLs, including GET forms. |

## Results

The job summary prints one of these:

- `clean`: every scanner completed and there are no high or critical findings. Medium and low findings can still be in the report.
- `high_or_critical`: every scanner completed and at least one high or critical finding is present. The job fails.
- `incomplete`: one or more scanners failed, or the encrypted artifact was not stored. The job fails. This is not a clean result, even when some scanners found nothing.
- `skipped`: the UTC slot is not the London 02:00 window. No scan ran.

High and critical findings fail the workflow. Medium and low findings are reported and do not, by themselves, fail it.

Reports include severity, file and line or URL, redacted evidence, and a suggested fix. Secret values are redacted in the report and in the job log. Query-string values and email addresses are redacted too, so a GET form the spider requests does not keep its field values. Parameter names stay in the URL.

## Permissions

The workflow token can read repository contents and upload artifacts (`contents: read`, `actions: write`). It cannot write code, open pull requests, or deploy.
