/**
 * Google Apps Script for Legal Shaman waitlist → Google Sheet
 *
 * Setup:
 * 1. Open your Google Sheet (row 1: Email | Submitted At)
 * 2. Extensions → Apps Script → paste this file → Save
 * 3. Set SECRET below (optional but recommended) and match WAITLIST_GOOGLE_APPS_SCRIPT_SECRET in .env.local
 * 4. Deploy → New deployment → Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the web app URL into WAITLIST_GOOGLE_APPS_SCRIPT_URL
 */

const SECRET = ""; // e.g. "change-me-to-a-long-random-string"

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (SECRET && data.secret !== SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }

    const email = String(data.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return json({ error: "Invalid email" }, 400);
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    sheet.appendRow([email, new Date()]);

    return json({ success: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

function json(obj, status) {
  const output = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
  if (status) {
    // Apps Script has no native status codes; clients check the JSON body.
    output.setMimeType(ContentService.MimeType.JSON);
  }
  return output;
}
