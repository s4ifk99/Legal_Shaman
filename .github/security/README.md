# Daily security scan

This workflow scans the default branch every day at 02:00 Europe/London and can also be started by hand. It does not fix, commit, or deploy anything.

## When it runs

GitHub Actions schedules are UTC. They do not move with UK daylight saving time. The workflow therefore registers two crons:

| London offset | Clock | Cron that runs the scan |
| --- | --- | --- |
| Greenwich Mean Time (UTC+0) | 02:00 | `0 2 * * *` |
| British Summer Time (UTC+1) | 02:00 | `0 1 * * *` |

`.github/security/scripts/london-schedule-gate.mjs` checks the cron that woke the job against the current Europe/London offset. The other UTC slot exits without scanning. A manual `workflow_dispatch` run does not wait for 02:00.

Limitations:

- GitHub can delay or skip a scheduled run. A delayed run still scans, because the gate uses the cron expression rather than the minute the runner started. If GitHub never starts that cron, that day's scan does not happen.
- On the morning the clocks go back, both 01:00 UTC and 02:00 UTC can be 02:00 in London. The scan may run twice that night.
- On the morning the clocks go forward, only the 01:00 UTC cron is 02:00 in London.
- The skipped UTC slot is a green workflow whose summary says that no scan ran. That green check is not a clean result.
- A manual run from a branch that does not contain this workflow cannot see these scripts. Leave `scan_ref` empty to scan the latest default branch. Set `scan_ref` only when you need another commit, and choose the branch that contains this workflow when you press Run.

## What you need to configure

Create one Actions secret:

`SECURITY_SCAN_REPORT_KEY`

Use a long random value that is not reused as an application password:

```bash
openssl rand -base64 32
```

GitHub stores the secret. Add it under Settings, Secrets and variables, Actions. The scanners do not need other new secrets.

This repository is public. Workflow artifacts are not a private store. The job encrypts the report with AES-256-CBC and PBKDF2 (200000 iterations) and uploads only the ciphertext. Retention is 14 days (`retention-days: 14`). If the secret is missing, the job fails and uploads nothing. That failure is a scan failure, not a clean bill of health.

Decrypt a downloaded artifact:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in security-report-YYYY-MM-DD.tar.gz.enc \
  -out security-report.tar.gz \
  -pass env:SECURITY_SCAN_REPORT_KEY
tar -xzf security-report.tar.gz
```

`security-report.md` has severity, file and line or URL, redacted evidence, and a suggested fix. The job summary on GitHub only has scanner status and counts.

## How a run is judged

| Result | Workflow | Meaning |
| --- | --- | --- |
| `clean` | success | Every required scanner finished, nothing was skipped by a coverage limit, and there were no high or critical findings. |
| `no_high_critical` | success | No high or critical findings in the scanned scope. The summary lists coverage limits. This is not a claim that every historical file was scanned. |
| `findings` | failure | Scanners finished and at least one high or critical finding was recorded. This is not a scanner crash. |
| `scan_failure` | failure | At least one required check did not finish, or the private report could not be stored. Do not treat the run as clean. |
| skipped UTC slot | success, with an explicit summary | No scanners ran. |

High and critical findings fail the workflow. Medium, low, and info stay in the encrypted report and do not fail it.

## Scanners

Versions are pinned in `.github/security/tool-versions.env`. The workflow calls those pins. It does not float to `:latest`.

| Check | Tool | Notes |
| --- | --- | --- |
| npm dependencies | `npm audit` | Uses `web/package-lock.json`. Package names and versions are sent to the npm advisory API. Source code is not. |
| npm and Python dependencies | osv-scanner 2.7.0 | Lockfile plus `scripts/exa/requirements-exa.txt`. Package names and versions are sent to the OSV API. The `fix` command is not used. |
| Secrets | gitleaks 8.30.1 | Git history, with `--redact`. Values are removed again before the report is saved. |
| Current data files | fixed key patterns | `web/data` filenames only. Matching lines are not copied. |
| Auth, injection, XSS, configuration, sensitive search text | `.github/security/scripts/app-security-checks.mjs` | Project checks for admin gates, webhook checks, `$queryRawUnsafe` interpolation, `NEXT_PUBLIC_` secret names, security headers, and stored search text. |
| Static analysis | Semgrep 1.182.0 image by digest | Local scan. `SEMGREP_SEND_METRICS=off`. No Semgrep Cloud token. Official rule packs are downloaded. Source stays on the runner. |
| Deployed site | OWASP ZAP baseline image by digest | Target is the shared `https://www.legalshaman.com` value in `web/lib/email/config.ts` and `web/.env.example`. If those disagree, ZAP does not run and the job asks for the URL. |

ZAP is the baseline spider plus passive scan. The active scanner is off (`scanner.attackOnStart=false`), form posting is off (`spider.postform=false`), and the job does not log in. Addon updates are disabled with `-silent` so the pinned image is what runs. `-I` keeps ZAP's own warning exit code from hiding the difference between a finished scan and a crash. This workflow then fails only when a ZAP alert is high, or when ZAP does not finish.

The ZAP target is read from the `resolveSiteUrl()` fallback in `web/lib/email/config.ts` and from `NEXT_PUBLIC_SITE_URL` in `web/.env.example` (the example may be commented). They must be the same https URL. Today that URL is `https://www.legalshaman.com`.

## Coverage limits

- Gitleaks does not read `web/data` or any file larger than 2 MB, including older copies in git history. Those blobs are large enough to exhaust a runner.
- The current `web/data` tree is checked only for a short list of key patterns (AWS key ids, live Stripe secrets, private keys, GitHub tokens).
- The public Ahrefs analytics site key is allowlisted. It is meant to be in the page. Other key material is not allowlisted.
- Semgrep scans application source, scripts, the static site, and workflows. It does not scan generated catalogues.
- There is no hashed Python lockfile. osv-scanner reads the pinned `exa-py` requirement only.
- ZAP does not authenticate and does not cover pages that require a signed-in user.
- Semgrep and ZAP need Docker on the runner. GitHub-hosted `ubuntu-latest` provides it.

## Permissions and network

The workflow token can read repository contents and upload artifacts. It cannot write code, open pull requests, or publish to the GitHub security tab.

No scanner is given an AI token. Semgrep Cloud, OSV fix, `npm audit fix`, and a ZAP active or authenticated scan are not part of this job.

## Stack this scan was written for

- Next.js application in `web/`, Node 22, npm, `web/package-lock.json`
- Hosted on Vercel (`web/vercel.json`), public site `https://www.legalshaman.com`
- Small Python helper at `scripts/exa/requirements-exa.txt`
- No existing CodeQL, Dependabot, gitleaks, or Semgrep workflow was present

## Updating a pin

Change `.github/security/tool-versions.env` and the matching action SHA in `.github/workflows/daily-security-scan.yml` in the same pull request. Record the new digest from the upstream release or image manifest. Do not switch the images to a moving tag.
