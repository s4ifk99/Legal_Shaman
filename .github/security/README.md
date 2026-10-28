# Daily security scan

This workflow scans the latest default-branch tree once a day at 02:00 Europe/London. It does not fix, commit, or deploy, and it does not send source code or user data to an external AI service.

## What you need to configure

Create one Actions secret:

`SECURITY_SCAN_REPORT_KEY`

Use a long random value, for example `openssl rand -base64 32`. Add it under Settings, Secrets and variables, Actions, as a repository secret.

The repository is public. GitHub Actions artifacts on a public repository can be downloaded by anyone who can see the repository, so the workflow refuses to upload a plaintext report. It encrypts the report with that secret and uploads only the ciphertext. Retention is 14 days.

Until the secret exists, the workflow fails at the publish step even if the scanners finish. The job summary says whether the scan itself passed, found high or critical issues, or did not finish. A missing secret is a publish failure, not a clean scan.

Decrypt a downloaded artifact:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 -iter 600000 \
  -in security-scan-YYYY-MM-DD.tar.gz.enc \
  -out security-scan.tar.gz \
  -pass env:SECURITY_SCAN_REPORT_KEY
tar -xzf security-scan.tar.gz
```

No other scan secret is required. npm audit and OSV-Scanner use public advisory APIs. Semgrep is not logged into Semgrep Cloud. ZAP is not given credentials.

Scheduled runs start only after this file is on the default branch. A manual run is available from the Actions tab (`workflow_dispatch`). Manual runs ignore the clock and still scan the default branch, using the workflow file from the branch you select.

## Schedule

GitHub cron is UTC and cannot express Europe/London. The UK is on GMT (UTC+0) in winter and BST (UTC+1) in summer.

| London time | UTC cron that matches |
| --- | --- |
| 02:00 GMT | 02:00 UTC |
| 02:00 BST | 01:00 UTC |

The workflow registers both crons. A small gate continues only when the runner clock says the hour is 02 in `Europe/London`. The other cron exits without scanning.

Limitations:

- GitHub can delay a scheduled job by minutes or hours. If the delay moves the start outside the 02:00 London hour, the gate skips it. The other cron does not replace a missed hour, so that day is skipped. Run the workflow manually.
- On the last Sunday in March, clocks go from 01:00 GMT to 02:00 BST (01:00 UTC). The 01:00 UTC job is the one that runs.
- On the last Sunday in October, 02:00 happens once, at 02:00 UTC, after the clocks return to GMT. The 02:00 UTC job is the one that runs.
- Both jobs share a concurrency group, so they do not scan at the same time. During GMT, a 01:00 UTC job that is delayed into the 02:00 UTC hour can pass the gate as well as the second cron. That can produce two scans in one night. Both are non-destructive.
- Schedules run only from the default branch. GitHub disables scheduled workflows on a public repository after 60 days without repository activity.
- The gate uses the runner timezone data for `Europe/London`.

## Scanners

| Check | Tool | Notes |
| --- | --- | --- |
| Dependency vulnerabilities | `npm audit` and OSV-Scanner | Lockfiles only: `web/package-lock.json` and `scripts/exa/requirements-exa.txt`. Package names and versions are sent to the public advisory APIs. Source code is not. |
| Static analysis | Semgrep | Local rules plus the OWASP Top 10, JavaScript, TypeScript, Next.js, Node.js, and React packs. Metrics off, autofix off, Semgrep Cloud not used. |
| Secrets | gitleaks | Current tree only, values redacted. The public Ahrefs analytics site key is allowlisted by exact value. |
| Auth, injection, XSS, configuration, personal data | repository checks | Admin and internal routes, webhook checks, raw SQL, HTML sinks, client-exposed secret names, security headers, stored search text. |
| Deployed site | OWASP ZAP baseline | `https://www.legalshaman.com` when `web/.env.example`, `resolveSiteUrl()`, and `metadataBase` agree. Spider for 1 minute and passive rules only. No login, no active scan. |

Versions and image digests are pinned in `versions.env`.

## How to read the result

The job summary is public. It has scanner status and high or critical identifiers. Evidence and suggested fixes are only in the encrypted report.

- `PASSED`: every scanner finished and there is no high or critical finding. Medium and low items may still be in the report.
- `FINDINGS`: every scanner finished and at least one high or critical finding exists. The workflow fails. This is not a clean result.
- `INCOMPLETE`: a scanner did not finish (missing Docker, URL sources disagree, a download failed, or similar). The workflow fails even if no finding was recorded. This is not a clean result.

High or critical findings fail the workflow. The workflow does not open a fix commit.

## What is not covered

- Git history. A secret that was removed from the latest tree is not reported.
- `data/` and `web/data/`. Those dumps are large and can contain personal data.
- Authenticated ZAP, active ZAP, or destructive tests.
- Automatic remediation.
