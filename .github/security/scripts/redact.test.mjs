import assert from "node:assert/strict"
import test from "node:test"
import { redactText } from "./redact.mjs"

test("secret-shaped values are removed and ordinary URLs remain", () => {
  const secret = ["sk", "or", "v1", "Q9mZ4pL8sT2kR7wX6nB3"].join("-")
  const token = `ghp_${"a1b2c3d4e5f60718293a4b5c6d7e8f90"}`
  const text = [
    `token=${secret}`,
    `postgres://postgres:${secret}@localhost/db`,
    `see ${token} in the log`,
    "https://www.legalshaman.com/search?q=private+query",
    "https://osv.dev/vulnerability/GHSA-35jp-ww65-95wh",
    "user@example.com",
  ].join("\n")
  const redacted = redactText(text, ["5ar5K5mpXwwkcFGOTKH51Q"])
  assert.equal(redacted.includes(secret), false)
  assert.equal(redacted.includes(token), false)
  assert.match(redacted, /\[REDACTED\]/)
  assert.match(redacted, /https:\/\/www\.legalshaman\.com\/search\?\[REDACTED-QUERY\]/)
  assert.match(redacted, /https:\/\/osv\.dev\/vulnerability\/GHSA-35jp-ww65-95wh/)
  assert.equal(redacted.includes("user@example.com"), false)
})
