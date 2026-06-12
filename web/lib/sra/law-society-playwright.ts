import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import type { ParsedLawSocietyResultRow } from "@/lib/sra/law-society-parse";

export const LAW_SOCIETY_HOME_URL =
  "https://solicitors.lawsociety.org.uk/?Pro=True";

export const LAW_SOCIETY_SEARCH_ACTION =
  "https://solicitors.lawsociety.org.uk/search/results";

const USER_AGENT =
  process.env.LAW_SOCIETY_USER_AGENT ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let browserSingleton: Browser | null = null;

export type LawSocietySearchAttempt = {
  strategy: "sra_id" | "postcode" | "display_name";
  query: string;
  finalUrl: string;
  httpStatus?: number;
  captchaBlocked: boolean;
  resultCountText?: string;
  resultCount: number;
  headings: string[];
  html: string;
  challengeDetected: boolean;
  challengeResolved: boolean;
  challengeTimedOut: boolean;
  navigationsObserved: number;
};

export type LawSocietyPlaywrightDebug = {
  screenshotPath?: string;
  htmlPath?: string;
  finalUrl: string;
  resultCountText?: string;
  headings: string[];
  captchaBlocked: boolean;
};

async function getBrowser(): Promise<Browser> {
  if (process.env.LAW_SOCIETY_RECOVERY_SKIP_PLAYWRIGHT === "1") {
    throw new Error("LAW_SOCIETY_RECOVERY_SKIP_PLAYWRIGHT=1");
  }
  if (!browserSingleton) {
    const { chromium } = await import("playwright");
    browserSingleton = await chromium.launch({
      headless: process.env.LAW_SOCIETY_HEADED !== "1",
      slowMo: process.env.LAW_SOCIETY_HEADED === "1" ? 80 : 0,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  return browserSingleton;
}

export async function closeLawSocietyBrowser(): Promise<void> {
  if (browserSingleton) {
    await browserSingleton.close();
    browserSingleton = null;
  }
}

async function newContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "en-GB",
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-GB,en;q=0.9" },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  return context;
}

/** Build GET URL for advanced organisation search (Name= not Term=). */
export function buildLawSocietyResultsUrl(args: {
  nameOrSraId: string;
  location?: string;
}): string {
  const params = new URLSearchParams({
    Pro: "True",
    Type: "0",
    Name: args.nameOrSraId.trim(),
    Location: args.location?.trim() ?? "",
    AreaOfPractice1: "",
  });
  return `${LAW_SOCIETY_SEARCH_ACTION}?${params.toString()}`;
}

export async function dismissLawSocietyCookieBanner(page: Page): Promise<void> {
  const accept = page.locator("#onetrust-accept-btn-handler");
  try {
    await accept.waitFor({ state: "visible", timeout: 12_000 });
    await accept.click({ timeout: 10_000, force: true });
    await page.locator(".onetrust-pc-dark-filter").waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    return;
  } catch {
    /* fall through */
  }

  for (const sel of [
    'button:has-text("Accept All Cookies")',
    'button:has-text("Accept all cookies")',
    'button:has-text("I Agree")',
  ]) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click({ force: true, timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      return;
    }
  }

  await page.evaluate(() => {
    document.querySelector("#onetrust-consent-sdk")?.remove();
    document.querySelector(".onetrust-pc-dark-filter")?.remove();
    document.querySelectorAll(".ot-fade-in").forEach((el) => el.remove());
  });
  await page.waitForTimeout(300);
}

async function submitAdvancedSearchForm(page: Page): Promise<void> {
  await dismissLawSocietyCookieBanner(page);
  const submitted = await page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    const advanced = forms.find((f) => f.querySelector("#Pro_Name, [name='Name']"));
    if (advanced instanceof HTMLFormElement) {
      advanced.requestSubmit();
      return true;
    }
    const btn = document.querySelector("#submitsearch") as HTMLButtonElement | null;
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (!submitted) {
    await page
      .locator("#submitsearch")
      .or(page.getByRole("button", { name: /search for a solicitor/i }))
      .first()
      .click({ force: true, timeout: 15_000 });
  }
}

async function fillAdvancedSearchForm(
  page: Page,
  args: { nameOrSraId: string; location?: string },
): Promise<void> {
  await page.locator("#Pro_Type_1").check({ timeout: 8000 }).catch(() => undefined);
  await page.getByLabel(/^Organisation$/i).check({ timeout: 3000 }).catch(() => undefined);

  const nameInput = page
    .locator("#Pro_Name")
    .or(page.getByLabel(/name or sra id/i))
    .or(page.getByPlaceholder(/name of organis/i));
  await nameInput.first().fill(args.nameOrSraId, { timeout: 10_000 });

  if (args.location?.trim()) {
    const loc = page.locator("#Pro_Location").or(page.getByLabel(/^Location$/i).last());
    await loc.first().fill(args.location.trim(), { timeout: 5000 }).catch(() => undefined);
  }
}

function isCaptchaUrl(url: string): boolean {
  return /failed-captcha|captcha|challenge/i.test(url);
}

/** WAF/CAPTCHA/block pages that make automated Law Society recovery non-scalable. */
export function isLawSocietyAccessBlocked(html: string, url = ""): boolean {
  if (isCaptchaUrl(url)) return true;
  const text = html.toLowerCase();
  return (
    /the request is blocked/.test(text) ||
    /access denied/.test(text) ||
    /failed-captcha/.test(text) ||
    /verify your browser/.test(text) ||
    (/please wait/i.test(text) && /verify/i.test(text))
  );
}

export async function extractResultsFromPage(
  page: Page,
): Promise<{ rows: ParsedLawSocietyResultRow[]; resultCountText?: string; headings: string[] }> {
  return page.evaluate(() => {
    const headings = [...document.querySelectorAll("h1, h2, h3")]
      .map((h) => h.textContent?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean)
      .slice(0, 20);

    const resultCountText =
      document.body.innerText.match(/\d+\s+results?\s+found/i)?.[0] ??
      document.body.innerText.match(/showing\s+\d+/i)?.[0] ??
      undefined;

    const rows: {
      organisationName: string;
      profileUrl: string;
      sraIdOnPage?: string;
      address?: string;
      phone?: string;
      website?: string;
      practiceAreas: string[];
      solicitors: string[];
    }[] = [];

    const seen = new Set<string>();
    const profileAnchors = [
      ...document.querySelectorAll('a[href*="/organisation/"]'),
      ...document.querySelectorAll('a[href*="/office/"]'),
    ];

    for (const anchor of profileAnchors) {
      const a = anchor as HTMLAnchorElement;
      const profileUrl = a.href;
      if (!profileUrl || seen.has(profileUrl)) continue;
      if (profileUrl.includes("/organisation/people/")) continue;
      seen.add(profileUrl);

      const card =
        a.closest("article, li, .search-result, .card, .result, tr, .panel, .details") ??
        a.parentElement?.parentElement;
      const text = card?.textContent?.replace(/\s+/g, " ") ?? "";
      const headingEl =
        card?.querySelector("h2 a, h2, h3 a, h3, .organisation a, .org-name") ?? a;
      let organisationName = headingEl?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const aka = text.match(/Also known as\s+(.{3,160}?)(?:\s{2,}|SRA|Head office|More information)/i);
      if (aka?.[1]) {
        const akaName = aka[1].trim();
        if (akaName.length > organisationName.length) {
          organisationName = akaName;
        }
      }

      const sraMatch = text.match(/\bSRA\s*(?:ID|number|No\.?|#)?\s*:?\s*(\d{4,})\b/i);
      const phoneMatch = text.match(
        /(?:Tel|Phone)[:\s]*(\+?\d[\d\s().-]{8,18}\d)/i,
      );
      const addressMatch = text.match(
        /(?:Head office|Address|Office)[:\s]*(.{10,120})/i,
      );

      rows.push({
        organisationName,
        profileUrl,
        sraIdOnPage: sraMatch?.[1],
        address: addressMatch?.[1]?.trim(),
        phone: phoneMatch?.[1]?.trim(),
        practiceAreas: [],
        solicitors: [],
      });
    }

    return { rows, resultCountText, headings };
  });
}

function isNavTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /Execution context was destroyed/i.test(msg) ||
    /Target closed/i.test(msg) ||
    /Navigation interrupted/i.test(msg)
  );
}

async function safeExtractResults(
  page: Page,
): Promise<{ rows: ParsedLawSocietyResultRow[]; resultCountText?: string; headings: string[] }> {
  for (let i = 0; i < 3; i++) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      return await extractResultsFromPage(page);
    } catch (e) {
      if (!isNavTransientError(e) || i === 2) throw e;
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    }
  }
  return { rows: [], headings: [] };
}

export async function saveLawSocietyDebugArtifacts(
  page: Page,
  sraId: string,
): Promise<LawSocietyPlaywrightDebug> {
  const reportsDir = path.join(process.cwd(), "reports", "lawsociety");
  await mkdir(reportsDir, { recursive: true });
  const base = path.join(reportsDir, `law-society-lookup-${sraId}`);
  const screenshotPath = `${base}.png`;
  const htmlPath = `${base}.html`;

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  const html = await page.content();
  await writeFile(htmlPath, html, "utf8");

  const { resultCountText, headings } = await safeExtractResults(page);
  const finalUrl = page.url();
  const captchaBlocked = isLawSocietyAccessBlocked(html, finalUrl);

  return {
    screenshotPath,
    htmlPath,
    finalUrl,
    resultCountText,
    headings,
    captchaBlocked,
  };
}

export function printLawSocietyDebug(diag: LawSocietyPlaywrightDebug): void {
  console.info(`finalUrl: ${diag.finalUrl}`);
  if (diag.resultCountText) console.info(`resultCountText: ${diag.resultCountText}`);
  if (diag.captchaBlocked) console.info("captchaBlocked: true");
  if (diag.headings.length) {
    console.info("headings (first 5):");
    for (const h of diag.headings.slice(0, 5)) console.info(`  - ${h}`);
  }
  if (diag.screenshotPath) console.info(`screenshot: ${diag.screenshotPath}`);
  if (diag.htmlPath) console.info(`html: ${diag.htmlPath}`);
}

async function waitForSearchResults(page: Page): Promise<Response | null> {
  try {
    return await page.waitForResponse(
      (r) =>
        r.url().includes("/search/results") &&
        r.request().method() === "GET" &&
        !r.url().includes("failed-captcha"),
      { timeout: 45_000 },
    );
  } catch {
    return null;
  }
}

async function isChallengePage(page: Page): Promise<boolean> {
  try {
    const body = page.locator("body");
    const text = (await body.textContent({ timeout: 3000 })) ?? "";
    return /verify your browser|please wait/i.test(text) || isCaptchaUrl(page.url());
  } catch {
    return isCaptchaUrl(page.url());
  }
}

export async function waitForChallengeResolution(
  page: Page,
): Promise<{
  challengeDetected: boolean;
  challengeResolved: boolean;
  challengeTimedOut: boolean;
  navigationsObserved: number;
}> {
  const timeoutMs = Number(process.env.LAW_SOCIETY_CHALLENGE_WAIT_MS ?? "90000");
  const started = Date.now();
  let challengeDetected = false;
  let challengeResolved = false;
  let challengeTimedOut = false;
  let navigationsObserved = 0;
  const onNav = () => {
    navigationsObserved++;
  };
  page.on("framenavigated", onNav);
  try {
    for (;;) {
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      const challenged = await isChallengePage(page);
      if (challenged) {
        challengeDetected = true;
      } else if (challengeDetected) {
        challengeResolved = true;
        break;
      } else {
        break;
      }
      if (Date.now() - started > timeoutMs) {
        challengeTimedOut = true;
        break;
      }
      await page.waitForTimeout(1500);
    }
  } finally {
    page.off("framenavigated", onNav);
  }
  return { challengeDetected, challengeResolved, challengeTimedOut, navigationsObserved };
}

/**
 * Open advanced search home, fill organisation + Name/SRA ID, submit.
 * Does not use direct /search/results?Term= URLs (wrong param + often 503).
 */
export async function runLawSocietyFormSearch(
  page: Page,
  args: {
    nameOrSraId: string;
    location?: string;
    strategy: LawSocietySearchAttempt["strategy"];
  },
): Promise<LawSocietySearchAttempt> {
  const reportsDir = path.join(process.cwd(), "reports", "lawsociety");
  await mkdir(reportsDir, { recursive: true });
  const base = path.join(reportsDir, `law-society-lookup-${args.nameOrSraId}`);
  await page.goto(LAW_SOCIETY_HOME_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);
  await dismissLawSocietyCookieBanner(page);
  await page.screenshot({ path: `${base}-before-challenge.png`, fullPage: true }).catch(() => undefined);
  let response: Response | null = null;
  let challenge = {
    challengeDetected: false,
    challengeResolved: false,
    challengeTimedOut: false,
    navigationsObserved: 0,
  };
  try {
    await fillAdvancedSearchForm(page, args);
    const responsePromise = waitForSearchResults(page);
    await submitAdvancedSearchForm(page);
    response = await responsePromise;
    challenge = await waitForChallengeResolution(page);

    if (process.env.LAW_SOCIETY_MANUAL_CAPTCHA === "1" && isCaptchaUrl(page.url())) {
      console.info("Waiting up to 120s for manual captcha solve (LAW_SOCIETY_MANUAL_CAPTCHA=1)…");
      await page.waitForURL((url) => !isCaptchaUrl(url.toString()), { timeout: 120_000 }).catch(() => undefined);
    }
  } finally {
    await page.screenshot({ path: `${base}-after-challenge.png`, fullPage: true }).catch(() => undefined);
    const finalHtml = await page.content().catch(() => "");
    if (finalHtml) {
      await writeFile(`${base}-final-page.html`, finalHtml, "utf8").catch(() => undefined);
    }
    await writeFile(`${base}-final-url.txt`, page.url(), "utf8").catch(() => undefined);
  }

  // Retry extraction after potential challenge resolution/navigation.
  const { rows, resultCountText, headings } = await safeExtractResults(page);
  const html = await page.content();
  const stillVerifying = /verify your browser|please wait/i.test(html) && rows.length === 0;

  return {
    strategy: args.strategy,
    query: args.nameOrSraId,
    finalUrl: page.url(),
    httpStatus: response?.status(),
    captchaBlocked: isLawSocietyAccessBlocked(html, page.url()) || stillVerifying,
    resultCountText,
    resultCount: rows.length,
    headings,
    html,
    challengeDetected: challenge.challengeDetected || stillVerifying,
    challengeResolved: challenge.challengeResolved,
    challengeTimedOut: challenge.challengeTimedOut,
    navigationsObserved: challenge.navigationsObserved,
  };
}

export async function withLawSocietyPage<T>(
  fn: (page: Page, context: BrowserContext) => Promise<T>,
): Promise<T> {
  const context = await newContext();
  const page = await context.newPage();
  try {
    return await fn(page, context);
  } finally {
    await context.close();
  }
}
