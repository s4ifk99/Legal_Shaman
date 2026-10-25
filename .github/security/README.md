# Daily security scan

This workflow scans the default branch every day at 02:00 Europe/London and can also be started with **Run workflow**. It does not change code, open fix pull requests, deploy, or run active attacks.

## What is scanned

| Check | Tool | Scope |
| --- | --- | --- |
| npm dependencies | `npm audit` on `web/package-lock.json` | Direct and transitive npm packages. Package names and versions go to the npm advisory database. Source code does not. |
| Other lockfiles | OSV-Scanner 2.7.0 | `web/package-lock.json` and `scripts/exa/requirements-exa.txt`. Package names and versions go to OSV and deps.dev. The `fix` command is not used. |
| Secrets | gitleaks 8.30.1 with `--redact=100` | Current checkout only. Git history is not scanned. `node_modules` and `.next` are skipped. |
| Static analysis | Semgrep OSS 1.182.0 | Repository rules plus `p/javascript`, `p/typescript`, `p/nextjs`, `p/nodejs`, and `p/owasp-top-ten`. Metrics and Semgrep Cloud upload are disabled. |
| App specific checks | `custom-checks.mjs` | Admin and internal auth gates, unsafe SQL, XSS sinks, persisted raw search queries, public analytics keys, ignored TypeScript build errors. |
| Deployed site | OWASP ZAP baseline image pinned by digest | `https://www.legalshaman.com`, passive rules only. |

The site URL is accepted only when `NEXT_PUBLIC_SITE_URL` in `web/.env.example` and the default in `web/lib/email/config.ts` are both `https://www.legalshaman.com`. If they diverge, the scan stops instead of guessing.

## Schedule limits

GitHub Actions cron is UTC. It has no Europe/London field, and it does not follow UK daylight saving time by itself.

The workflow therefore schedules `01:00 UTC` and `02:00 UTC`. A small script keeps the run only when that UTC hour is 02:00 in London:

- British Summer Time (UTC+1): the 01:00 UTC run continues.
- Greenwich Mean Time (UTC+0): the 02:00 UTC run continues.
- The other run records a skip and does not scan.

If GitHub starts the job after that UTC hour, the gate skips it so the scan does not run late and does not run twice. Use **Run workflow** to catch up. GitHub can also drop scheduled runs during incidents, or after a long stretch with no repository activity.

A manual run scans the commit you select. The scheduled run checks out the default branch (`main`).

## Results

High or critical findings fail the workflow. That failure means the scanners finished and found something. It is separate from a scanner crash. Semgrep rules set to WARNING, including unpinned third party action tags, are reported as medium and do not fail the job. Semgrep ERROR rules do.

Exit 2, or a check status of `scan_failed`, means a scanner did not finish or the private report could not be stored. That result is not clean, even when some checks found nothing.

Medium, low, and info findings are reported and do not fail the job. Coverage notes are listed in the same report. The summary uses the word clean only when every check finished with no findings and no coverage gaps.

Reports include severity, file and line or URL, redacted evidence, and a suggested fix. Secret values are redacted before the report is written. ZAP request and response bodies are not copied into the summary.

## Private artifacts

This repository is public. GitHub Actions artifacts on a public repository are visible to anyone who can see the workflow run. The workflow therefore encrypts the report with AES-256-CBC (PBKDF2, 200000 iterations) and uploads only the ciphertext.

Retention is 14 days.

### Secret you must add

Create a repository Actions secret named `SECURITY_SCAN_REPORT_KEY`.

```bash
openssl rand -base64 32
```

Put that value in the secret. Do not commit it. Until the secret exists, the scan still runs and prints a redacted summary, but it does not upload a report and the workflow fails as incomplete.

Decrypt a downloaded artifact locally:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass env:SECURITY_SCAN_REPORT_KEY \
  -in legalshaman-security-scan-YYYY-MM-DD.tar.gz.enc \
  -out report.tar.gz
tar -xzf report.tar.gz
```

No other new secrets are required. ZAP is unauthenticated. npm audit and OSV-Scanner use public advisory services.

## Pinned tools

- `actions/checkout` `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1)
- `actions/setup-node` `949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0)
- `actions/upload-artifact` `cf430e030ddbb5b0abf93d22962f4752f3646cd9` (v7.0.2)
- gitleaks 8.30.1, sha256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`
- OSV-Scanner 2.7.0, sha256 `160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b`
- Semgrep 1.182.0
- `ghcr.io/zaproxy/zaproxy` digest `sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6` (stable index resolved 2026-10-25)

Token permissions are `contents: read` and `actions: write`. The actions permission is only for uploading the encrypted artifact.

## ZAP bounds

The baseline spider runs for at most 2 minutes, depth 2, 20 children per node, and 2 threads. Form posts stay off. Authenticated scanning and the active scanner are not used. A finished baseline with no high alerts is not a statement that the whole site is free of vulnerabilities.

## Known coverage gaps

These are reported on every run. They do not by themselves mean the scanners crashed.

- Python scripts import `pandas`, `requests`, and `numpy` without a lockfile, so those versions are not sent to OSV.
- `web/data` content indexes are excluded from Semgrep and from the project pattern checks. gitleaks still scans them, except the LinkedIn client-id rule, which mismatches generated wiki text.
- The hardcoded Ahrefs browser analytics key is an intentional public client key. gitleaks ignores that one rule in that file. The project check still reports it at low severity.
- Git history is not secret scanned.
