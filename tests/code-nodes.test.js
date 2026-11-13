import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { runCodeNode, claudeReply } from "./harness.js";

const sample = (f) => JSON.parse(readFileSync(new URL(`../samples/${f}`, import.meta.url)));

test("normalises different form payloads into one shape", () => {
  const [web, tally, junk] = runCodeNode("normalise-enquiry.js", sample("enquiries.json"));
  assert.equal(web.email, "ana.hoxha@example.com");
  assert.equal(web.phone, "+355691234567");
  assert.equal(web.valid, true);
  assert.equal(tally.name, "Marco Bianchi");
  assert.equal(tally.source, "tally-contact");
  assert.equal(junk.valid, false, "no contact details");
});

test("AI triage is merged with the enquiry and hard rules override the model", () => {
  const enquiries = runCodeNode("normalise-enquiry.js", sample("enquiries.json")).slice(0, 2);
  const [a, b] = runCodeNode(
    "parse-ai-triage.js",
    [
      claudeReply({ category: "quote_request", urgency: "normal", language: "sq", summary: "Wants a quote", draft_reply: "Faleminderit…", needs_review: false }),
      claudeReply({ category: "support", urgency: "low", language: "it", summary: "Asks about order", draft_reply: "Grazie…", needs_review: false }),
    ],
    { "Normalise enquiry": enquiries }
  );
  assert.equal(a.category, "quote_request");
  assert.equal(a.email, "ana.hoxha@example.com");
  assert.equal(a.urgency, "normal");
  // Marco mentions a refund: urgent even though the model said low.
  assert.equal(b.urgency, "high");
});

test("bad AI output falls back to manual review instead of failing", () => {
  const enquiries = runCodeNode("normalise-enquiry.js", sample("enquiries.json")).slice(0, 1);
  const [r] = runCodeNode("parse-ai-triage.js", [{ content: [{ type: "text", text: "not json" }] }], { "Normalise enquiry": enquiries });
  assert.equal(r.needs_review, true);
  assert.equal(r.category, "other");
});

test("unknown categories from the model are coerced to 'other'", () => {
  const enquiries = runCodeNode("normalise-enquiry.js", sample("enquiries.json")).slice(0, 1);
  const [r] = runCodeNode("parse-ai-triage.js", [claudeReply({ category: "lottery", urgency: "normal" })], { "Normalise enquiry": enquiries });
  assert.equal(r.category, "other");
});

test("invoice validation accepts correct maths and flags mistakes", () => {
  const [good, wrongTotal, missing] = runCodeNode("validate-invoice.js", sample("invoices.json").map(claudeReply));
  assert.equal(good.ok, true, good.problems);
  assert.equal(wrongTotal.ok, false);
  assert.match(wrongTotal.problems, /net \+ VAT/);
  assert.equal(missing.ok, false);
  assert.match(missing.problems, /missing invoice_number/);
});

test("daily stats only count yesterday", () => {
  const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(10);
  const today = new Date();
  const rows = [
    { receivedAt: y.toISOString(), category: "booking", source: "website", urgency: "normal" },
    { receivedAt: y.toISOString(), category: "complaint", source: "website", urgency: "high", status: "", id: "E1", name: "Ana", summary: "Cold food" },
    { receivedAt: y.toISOString(), category: "spam", source: "tally", urgency: "low" },
    { receivedAt: today.toISOString(), category: "booking", source: "website", urgency: "normal" },
  ];
  const [s] = runCodeNode("daily-stats.js", rows);
  assert.equal(s.total, 3);
  assert.deepEqual(s.byCategory, { booking: 1, complaint: 1, spam: 1 });
  assert.equal(s.urgentOpen.length, 1);
  assert.equal(s.spam, 1);
});

for (const file of readdirSync(new URL("../workflows/", import.meta.url))) {
  test(`${file}: every connection points at a real node and no secrets are stored`, () => {
    const raw = readFileSync(new URL(`../workflows/${file}`, import.meta.url), "utf8");
    const wf = JSON.parse(raw);
    const names = new Set(wf.nodes.map((n) => n.name));
    for (const [from, { main }] of Object.entries(wf.connections)) {
      assert.ok(names.has(from), `unknown source ${from}`);
      for (const out of main) for (const c of out) assert.ok(names.has(c.node), `unknown target ${c.node}`);
    }
    assert.doesNotMatch(raw, /sk-ant-|xox[bp]-|AIza/, "no API keys in workflow files");
    for (const n of wf.nodes.filter((n) => n.credentials)) {
      for (const c of Object.values(n.credentials)) assert.equal(c.id, "", "credentials are placeholders");
    }
  });
}

test("workflow files are up to date with code/", () => {
  const wf = JSON.parse(readFileSync(new URL("../workflows/1-enquiry-triage.json", import.meta.url)));
  const node = wf.nodes.find((n) => n.name === "Normalise enquiry");
  assert.equal(node.parameters.jsCode, readFileSync(new URL("../code/normalise-enquiry.js", import.meta.url), "utf8"));
});
