# Daily security scan

Scheduled GitHub Actions workflow: `.github/workflows/daily-security-scan.yml`.

It scans the default branch. It does not change code, open pull requests, deploy, or run an active attack against the site.

## Schedule

GitHub Actions cron is UTC. It cannot take a timezone, and it does not move with UK daylight saving time.

The workflow is registered twice:

- `0 1 * * *` (01:00 UTC)
- `0 2 * * *` (02:00 UTC)

`.github/security/scripts/london-schedule-gate.mjs` keeps the slot that is 02:00 in `Europe/London`.

- British Summer Time (UTC+1, last Sunday in March through the last Sunday in October): 02:00 London is 01:00 UTC.
- GMT (UTC+0): 02:00 London is 02:00 UTC.

The gate uses the cron expression that started the job. If GitHub starts a 01:00 UTC job late, it still counts as the 01:00 slot. The other slot exits successfully and records that no scan ran. That skip is not a clean result.

Other limits:

- GitHub can delay or drop a scheduled run. This workflow cannot promise that the job starts at 02:00 exactly.
- Scheduled workflows run only from the default branch, and only after this workflow file is on that branch.
- A manual run is Actions, Daily security scan, Run workflow. Choose the branch to scan. The daily schedule always uses the default branch.

## What the scan uses

Stack this was built for: Next.js 16 in `web/` (npm, `web/package-lock.json`, Node 22), Vercel (`web/vercel.json`), a static directory at the repo root, and existing GitHub Actions. There was no dependency, secret, or ZAP workflow before this file.

| Check | Tool | Notes |
| --- | --- | --- |
| Dependencies | `npm audit` | `web/package-lock.json` only. `npm audit fix` is not run. |
| Dependencies | osv-scanner 2.7.0 | Same lockfile. `osv-scanner fix` is not run. |
| Secrets | gitleaks 8.30.1 | Git history of HEAD. Values are redacted. |
| Static analysis | Semgrep 1.181.1 | Local Docker image. Metrics off. No Semgrep Cloud token. |
| App checks | `application-checks.mjs` | Auth, authorisation, injection, XSS, headers, sensitive logs. |
| Deployed site | OWASP ZAP baseline | `https://www.legalshaman.com`, passive only. |

The deployed URL is accepted only when `web/.env.example` (`NEXT_PUBLIC_SITE_URL`), the fallback in `web/lib/email/config.ts`, and `metadataBase` in `web/app/layout.tsx` all say `https://www.legalshaman.com`. If they disagree, ZAP does not run and the job fails. No other URL is guessed.

ZAP uses the pinned `ghcr.io/zaproxy/zaproxy` image. Spider time is one minute, depth 2, two threads, form posts off, update checks off. It does not log in and it does not run `zap-full-scan` or an active scan.

Semgrep rule packs: `p/default`, `p/owasp-top-ten`, `p/nextjs`, `p/react`, `p/nodejs`, plus `.github/security/semgrep/legalshaman.yml`. Generated trees `data/` and `web/data/` are ignored.

gitleaks reads history for `HEAD` only. It skips `data/`, `web/data/`, and files larger than 2 MB. The public Ahrefs analytics key is allowlisted by its exact value, including older copies in `web/app/layout.tsx`. Do not add other keys to that allowlist.

Checksums and image digests live in `.github/security/tool-versions.env`. Action SHAs are pinned in the workflow file. `self-test.mjs` checks that those SHAs match the version file.

## How a run is judged

Required scanners: npm audit, OSV, gitleaks, Semgrep, ZAP baseline, application checks.

- All of those finish, and there is no high or critical finding: conclusion `clean`. The job succeeds. Coverage gaps are still listed. `clean` means no high or critical finding in the checks that finished. It does not mean the service has no weaknesses.
- All of those finish, and a high or critical finding exists: conclusion `findings`. The job fails.
- Any required scanner fails or does not run: conclusion `incomplete`. The job fails. This is not a clean result, even if some finished checks found nothing.

Medium, low, and info findings are stored in the report and do not fail the job.

The public job summary lists scanner status, coverage gaps, and high or critical titles with file, line, or URL. It does not include evidence snippets. Evidence and suggested fixes are inside the encrypted report.

## Secret you must configure

Repository Actions secret: `SECURITY_SCAN_REPORT_KEY`.

The repository is public. Workflow artifacts can be downloaded by anyone who can read the repository, so plaintext reports are not uploaded.

Create a passphrase on your machine:

```bash
openssl rand -base64 32
```

Add it under Settings, Secrets and variables, Actions, New repository secret. Name it `SECURITY_SCAN_REPORT_KEY`. Do not commit it. No other secret is required for this workflow. Do not add `SEMGREP_APP_TOKEN`. If that token is present in the job, Semgrep refuses to run.

If the key is missing, encryption is skipped, nothing is uploaded, and the job fails as incomplete.

Artifact name: `security-report-YYYY-MM-DD-<run id>-<attempt>`. Retention: 14 days.

Decrypt a downloaded artifact (the zip from Actions contains the `.enc` file):

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass env:SECURITY_SCAN_REPORT_KEY \
  -in security-report-YYYY-MM-DD.tar.gz.enc \
  -out security-report.tar.gz
tar -xzf security-report.tar.gz
```

`report.md` and `report.json` include severity, location, redacted evidence, and a suggested fix.

## Permissions

- `contents: read` to check out the repository
- `actions: write` so the encrypted artifact can be uploaded

Checkout uses `persist-credentials: false`. The report passphrase is passed only to the encrypt step.

## Coverage that does not run

These are recorded on every report. They are not treated as a passed check.

- Python scripts import `pandas`, `requests`, and `numpy`, and the repo has no Python lockfile. npm audit and OSV do not assess them.
- ZAP does not sign in, does not cover admin or account flows, and does not run an active scan.
- Secret scanning does not read `data/`, `web/data/`, files over 2 MB, or branches other than the checked out HEAD.
- Semgrep does not upload source to Semgrep Cloud. It does download rule packs.
- npm audit and OSV send package names and versions to public advisory services. They do not send application source or user records.
- CodeQL is not configured.

## Run it locally

From the repository root, with Node 22:

```bash
node .github/security/scripts/self-test.mjs
```

Docker is required for Semgrep and ZAP. Without Docker those two scanners record a failure and the report conclusion is incomplete.

```bash
export REPORT_DIR=/tmp/legalshaman-security
export SCANNER_BIN=/tmp/legalshaman-scanners
bash .github/security/scripts/install-pinned-scanners.sh "$SCANNER_BIN"
bash .github/security/scripts/run-npm-audit.sh
bash .github/security/scripts/run-osv.sh
bash .github/security/scripts/run-gitleaks.sh
node .github/security/scripts/application-checks.mjs
bash .github/security/scripts/run-semgrep.sh
node .github/security/scripts/resolve-scan-target.mjs
bash .github/security/scripts/run-zap.sh
node .github/security/scripts/assemble-report.mjs
```

Do not print `gitleaks.raw.json` or Semgrep logs. The gitleaks wrapper deletes the raw file after redaction.
