# Daily security scan

This workflow scans the latest default branch code and the public website. It does not fix, commit, or deploy. It does not send source code or user data to an external AI service.

Scheduled runs start only after this file is on the default branch. Use **Run workflow** to start it manually.

## Schedule

The intended time is **02:00 Europe/London**, including British Summer Time.

GitHub Actions cron accepts UTC only, and a run can start late. The workflow therefore registers two slots:

- `0 1 * * *` (01:00 UTC), which is 02:00 London during British Summer Time
- `0 2 * * *` (02:00 UTC), which is 02:00 London during Greenwich Mean Time

A small gate runs the slot that matches 02:00 London on that civil date. The other slot exits as **skipped**. A skip is not a scan and it is not a clean result.

If GitHub starts the matching slot late, the scan still runs while London time is 02:00 through 05:59. After 05:59 London time that day's scheduled scan is skipped. On the March and October clock changes, unit tests expect a single run rather than two.

GitHub can also disable scheduled workflows after 60 days without a repository update.

## What you must configure

Create a long random passphrase and store it as the Actions secret `SECURITY_SCAN_REPORT_KEY` (at least 16 characters). For example:

```bash
openssl rand -base64 32
```

Add it under Settings, Secrets and variables, Actions. Do not commit it.

The repository is public. Workflow artifacts must be treated as downloadable. The job encrypts the report with AES-256-GCM before upload and refuses to upload plaintext. Artifact retention is 14 days.

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

## Scanners

Versions are pinned in `versions.env`.

| Scanner | Role |
| --- | --- |
| npm audit | Vulnerabilities in `web/package-lock.json`. No `npm audit fix`. |
| osv-scanner 2.7.0 | Same lockfile, plus `scripts/exa/requirements-exa.txt`. Package names and versions are sent to the OSV / deps.dev services. Source code is not. No `osv-scanner fix`. |
| gitleaks 8.30.1 | Working tree only, with `--redact=100`. Git history is not scanned. `data/`, `web/data/`, and files over 2 MB are skipped. |
| Application checks | Local Node checks for authentication, authorisation, exposed keys, injection, XSS, insecure configuration, and sensitive user data. |
| Semgrep 1.182.0 | Local `semgrep scan` in a pinned image. Metrics and Semgrep App are off. `semgrep ci` is not used. Community rule packs are downloaded. Source is mounted read only. |
| OWASP ZAP baseline | Unauthenticated passive baseline of the public site. Forms are not submitted. No active attack policy and no login. Spider cap 5 minutes, depth 4, passive scan cap 20 minutes. |

## Results

The job summary prints one of these:

- `clean`: every scanner completed and there are no high or critical findings. Medium and low findings can still be in the report.
- `high_or_critical`: every scanner completed and at least one high or critical finding is present. The job fails.
- `incomplete`: one or more scanners failed, or the encrypted artifact was not stored. The job fails. This is not a clean result, even when some scanners found nothing.
- `skipped`: the UTC slot is not the London 02:00 window. No scan ran.

High and critical findings fail the workflow. Medium and low findings are reported and do not, by themselves, fail it.

Reports include severity, file and line or URL, redacted evidence, and a suggested fix. Secret values are redacted in the report and in the job log.

## Permissions

The workflow token can read repository contents and upload artifacts (`contents: read`, `actions: write`). It cannot write code, open pull requests, or deploy.
