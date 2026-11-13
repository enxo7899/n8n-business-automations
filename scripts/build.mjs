// Builds the importable n8n workflow files in workflows/ from the Code node
// sources in code/, so the JavaScript can be tested on its own.
//   node scripts/build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const code = (f) => readFileSync(new URL(`../code/${f}`, import.meta.url), "utf8");
let uid = 0;
const id = (p) => `${p}-${String(++uid).padStart(4, "0")}`;

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-5-5";

// Claude call through the HTTP Request node. The API key lives in an n8n
// "Header Auth" credential (name: x-api-key), never in the workflow file.
function claudeNode(name, position, { system, user, schema, effort = "low" }) {
  const body = `={{ JSON.stringify({
  model: "${CLAUDE_MODEL}",
  max_tokens: 2048,
  output_config: { effort: "${effort}", format: { type: "json_schema", schema: ${JSON.stringify(schema)} } },
  fallbacks: "default",
  system: ${JSON.stringify(system)},
  messages: [{ role: "user", content: ${user} }]
}) }}`;
  return {
    id: id("claude"),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    parameters: {
      method: "POST",
      url: CLAUDE_URL,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "anthropic-version", value: "2023-06-01" },
          { name: "anthropic-beta", value: "server-side-fallback-2026-07-01" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: body,
      options: { timeout: 60000, retry: { maxTries: 3 } },
    },
    credentials: { httpHeaderAuth: { id: "", name: "Anthropic API key" } },
  };
}

const codeNode = (name, position, file) => ({
  id: id("code"),
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position,
  parameters: { jsCode: code(file) },
});

const ifNode = (name, position, leftValue) => ({
  id: id("if"),
  name,
  type: "n8n-nodes-base.if",
  typeVersion: 2,
  position,
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
      conditions: [{ id: id("cond"), leftValue, rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }],
      combinator: "and",
    },
    options: {},
  },
});

const sheetAppend = (name, position, sheet) => ({
  id: id("sheet"),
  name,
  type: "n8n-nodes-base.googleSheets",
  typeVersion: 4.5,
  position,
  parameters: {
    operation: "append",
    documentId: { __rl: true, mode: "id", value: "YOUR_GOOGLE_SHEET_ID" },
    sheetName: { __rl: true, mode: "name", value: sheet },
    columns: { mappingMode: "autoMapInputData", value: {} },
    options: {},
  },
  credentials: { googleSheetsOAuth2Api: { id: "", name: "Google Sheets" } },
});

const slack = (name, position, text, channel = "#leads") => ({
  id: id("slack"),
  name,
  type: "n8n-nodes-base.slack",
  typeVersion: 2.2,
  position,
  parameters: { select: "channel", channelId: { __rl: true, mode: "name", value: channel }, text, otherOptions: {} },
  credentials: { slackApi: { id: "", name: "Slack" } },
});

const link = (pairs) => {
  const c = {};
  for (const [from, to, output = 0] of pairs) {
    c[from] ??= { main: [] };
    while (c[from].main.length <= output) c[from].main.push([]);
    c[from].main[output].push({ node: to, type: "main", index: 0 });
  }
  return c;
};

const workflow = (name, nodes, connections, notes) => ({
  name,
  nodes: [
    {
      id: id("note"),
      name: "About this workflow",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [-460, -260],
      parameters: { content: notes, width: 420, height: 300, color: 4 },
    },
    ...nodes,
  ],
  connections,
  settings: { executionOrder: "v1", saveManualExecutions: true, errorWorkflow: "" },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [],
});

// ---------------------------------------------------------------- 1. Enquiries
const triageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["category", "urgency", "language", "summary", "draft_reply", "needs_review"],
  properties: {
    category: { type: "string", enum: ["new_customer", "quote_request", "booking", "complaint", "support", "spam", "other"] },
    urgency: { type: "string", enum: ["low", "normal", "high"] },
    language: { type: "string", description: "ISO 639-1 code of the customer's language" },
    summary: { type: "string", description: "One sentence, in English" },
    draft_reply: { type: "string", description: "Short polite reply in the customer's language. Never promise prices, dates or refunds." },
    needs_review: { type: "boolean", description: "true if unclear, sensitive, or you are unsure" },
  },
};

const enquiries = workflow(
  "1 · New enquiry → AI triage → Sheets + Slack + draft reply",
  [
    { id: id("hook"), name: "New enquiry", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: "enquiry", parameters: { httpMethod: "POST", path: "enquiry", responseMode: "responseNode", options: {} } },
    codeNode("Normalise enquiry", [220, 0], "normalise-enquiry.js"),
    ifNode("Valid?", [440, 0], "={{ $json.valid }}"),
    claudeNode("Claude: triage", [680, -100], {
      system:
        "You triage incoming customer enquiries for a small business. Classify the enquiry, judge urgency, write a one-sentence English summary and a short draft reply in the customer's language. The draft is reviewed by a person before sending: never promise prices, dates, discounts or refunds.",
      user: "`From: ${$json.name} <${$json.email}> ${$json.phone}\\nSource: ${$json.source}\\n\\n${$json.message}`",
      schema: triageSchema,
    }),
    codeNode("Parse AI triage", [900, -100], "parse-ai-triage.js"),
    ifNode("Spam?", [1120, -100], "={{ $json.is_spam }}"),
    sheetAppend("Log to Leads sheet", [1360, 0], "Leads"),
    ifNode("Urgent?", [1580, 0], "={{ $json.urgency === 'high' }}"),
    slack("Alert team on Slack", [1820, -100], "=:rotating_light: *Urgent {{ $json.category }}* from {{ $json.name }} ({{ $json.email || $json.phone }})\n>{{ $json.summary }}\nSheet row: {{ $json.id }}"),
    {
      id: id("gmail"),
      name: "Create Gmail draft reply",
      type: "n8n-nodes-base.gmail",
      typeVersion: 2.1,
      position: [1820, 120],
      parameters: { resource: "draft", subject: "=Re: your enquiry", message: "={{ $json.draft_reply }}", options: { sendTo: "={{ $json.email }}" } },
      credentials: { gmailOAuth2: { id: "", name: "Gmail" } },
    },
    { id: id("resp"), name: "Reply 200", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [1360, -220], parameters: { respondWith: "json", responseBody: "={{ { ok: true, id: $json.id } }}", options: {} } },
    { id: id("resp"), name: "Reply 400", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [680, 140], parameters: { respondWith: "json", responseBody: '={{ { ok: false, error: "A message and a valid email or phone are required" } }}', options: { responseCode: 400 } } },
  ],
  link([
    ["New enquiry", "Normalise enquiry"],
    ["Normalise enquiry", "Valid?"],
    ["Valid?", "Claude: triage", 0],
    ["Valid?", "Reply 400", 1],
    ["Claude: triage", "Parse AI triage"],
    ["Parse AI triage", "Spam?"],
    ["Spam?", "Reply 200", 0],
    ["Spam?", "Log to Leads sheet", 1],
    ["Spam?", "Reply 200", 1],
    ["Log to Leads sheet", "Urgent?"],
    ["Urgent?", "Alert team on Slack", 0],
    ["Urgent?", "Create Gmail draft reply", 0],
    ["Urgent?", "Create Gmail draft reply", 1],
  ]),
  "## New enquiry → AI triage\nA website form, Tally or Typeform posts to the webhook.\n\n1. Clean up the payload and reject junk\n2. Claude classifies it and drafts a reply (structured JSON)\n3. Business rules override the model for complaints and refunds\n4. Every real enquiry is logged to Google Sheets\n5. Urgent ones ping Slack; all get a Gmail **draft** a person approves\n\nSpam is acknowledged but never logged."
);

// ---------------------------------------------------------------- 2. Invoices
const invoiceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["supplier", "invoice_number", "invoice_date", "due_date", "currency", "net", "vat", "total", "lines"],
  properties: {
    supplier: { type: "string" },
    invoice_number: { type: "string" },
    invoice_date: { type: "string", description: "YYYY-MM-DD" },
    due_date: { type: "string", description: "YYYY-MM-DD or empty" },
    currency: { type: "string", description: "ISO 4217 code" },
    net: { type: "number" },
    vat: { type: "number" },
    total: { type: "number" },
    lines: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["description", "amount"], properties: { description: { type: "string" }, amount: { type: "number" } } },
    },
  },
};

const invoices = workflow(
  "2 · Invoice email → extract with AI → validate → Sheets or review queue",
  [
    {
      id: id("gmailtrig"),
      name: "Invoice email arrives",
      type: "n8n-nodes-base.gmailTrigger",
      typeVersion: 1.2,
      position: [0, 0],
      parameters: { pollTimes: { item: [{ mode: "everyX", value: 5, unit: "minutes" }] }, simple: false, filters: { q: "has:attachment filename:pdf (invoice OR fattura OR fature)" }, options: { downloadAttachments: true } },
      credentials: { gmailOAuth2: { id: "", name: "Gmail" } },
    },
    { id: id("pdf"), name: "Read PDF text", type: "n8n-nodes-base.extractFromFile", typeVersion: 1, position: [220, 0], parameters: { operation: "pdf", binaryPropertyName: "attachment_0", options: {} } },
    claudeNode("Claude: extract fields", [440, 0], {
      system:
        "You extract accounting data from supplier invoices (English, Italian or Albanian). Copy values exactly as printed. Use numbers without thousand separators. If a field is not on the invoice, return an empty string or 0; never guess.",
      user: "`Invoice text:\\n\\n${$json.text}`",
      schema: invoiceSchema,
    }),
    codeNode("Validate invoice", [660, 0], "validate-invoice.js"),
    ifNode("Numbers add up?", [880, 0], "={{ $json.ok }}"),
    sheetAppend("Add to Invoices sheet", [1120, -100], "Invoices"),
    sheetAppend("Add to Review queue", [1120, 120], "Review queue"),
    slack("Ask a person to check", [1360, 120], "=:mag: Invoice needs a check: *{{ $json.supplier || 'unknown supplier' }}* {{ $json.invoice_number }}\nProblems: {{ $json.problems }}", "#accounts"),
  ],
  link([
    ["Invoice email arrives", "Read PDF text"],
    ["Read PDF text", "Claude: extract fields"],
    ["Claude: extract fields", "Validate invoice"],
    ["Validate invoice", "Numbers add up?"],
    ["Numbers add up?", "Add to Invoices sheet", 0],
    ["Numbers add up?", "Add to Review queue", 1],
    ["Add to Review queue", "Ask a person to check"],
  ]),
  "## Invoice email → spreadsheet\nWatches Gmail for PDF invoices (EN / IT / AL).\n\n1. Reads the PDF text\n2. Claude extracts supplier, number, dates, net, VAT, total and lines as strict JSON\n3. Code checks the maths: net + VAT = total, lines = net, dates parse, fields present\n4. Clean invoices go straight to the Invoices sheet\n5. Anything that doesn't add up goes to a Review queue and pings #accounts"
);

// ---------------------------------------------------------------- 3. Daily summary
const daily = workflow(
  "3 · Daily 8am summary of yesterday's enquiries → Slack",
  [
    { id: id("cron"), name: "Every day at 8:00", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [{ field: "days", triggerAtHour: 8 }] } } },
    {
      id: id("sheetread"),
      name: "Read Leads sheet",
      type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.5,
      position: [220, 0],
      parameters: { documentId: { __rl: true, mode: "id", value: "YOUR_GOOGLE_SHEET_ID" }, sheetName: { __rl: true, mode: "name", value: "Leads" }, options: {} },
      credentials: { googleSheetsOAuth2Api: { id: "", name: "Google Sheets" } },
    },
    codeNode("Yesterday's numbers", [440, 0], "daily-stats.js"),
    claudeNode("Claude: write summary", [660, 0], {
      system: "You write a short morning briefing for a small-business owner from yesterday's enquiry statistics. Use only the numbers given. Plain English, at most 6 lines, lead with anything urgent still open.",
      user: "JSON.stringify($json)",
      schema: { type: "object", additionalProperties: false, required: ["briefing"], properties: { briefing: { type: "string" } } },
    }),
    slack("Post to #daily", [880, 0], "={{ JSON.parse($json.content.find(c => c.type === 'text').text).briefing }}", "#daily"),
  ],
  link([
    ["Every day at 8:00", "Read Leads sheet"],
    ["Read Leads sheet", "Yesterday's numbers"],
    ["Yesterday's numbers", "Claude: write summary"],
    ["Claude: write summary", "Post to #daily"],
  ]),
  "## Morning briefing\nEvery day at 8:00 it reads yesterday's rows from the Leads sheet (filled by workflow 1), counts them by category and source, lists urgent enquiries still open, and posts a short summary to Slack.\n\nThe counting is done in code; Claude only writes the sentences."
);

// ---------------------------------------------------------------- 4. Error alerts
const errors = workflow(
  "4 · Error alerts for all workflows",
  [
    { id: id("err"), name: "When any workflow fails", type: "n8n-nodes-base.errorTrigger", typeVersion: 1, position: [0, 0], parameters: {} },
    slack("Alert on Slack", [240, 0], "=:x: *{{ $json.workflow.name }}* failed at node *{{ $json.execution.lastNodeExecuted }}*\n>{{ $json.execution.error.message }}\n<{{ $json.execution.url }}|Open execution>", "#automation-alerts"),
  ],
  link([["When any workflow fails", "Alert on Slack"]]),
  "## Error alerts\nSet this as the *Error workflow* in the settings of workflows 1–3. Any failure posts the workflow, the failing node, the error and a link to the execution."
);

const all = {
  "1-enquiry-triage.json": enquiries,
  "2-invoice-extraction.json": invoices,
  "3-daily-summary.json": daily,
  "4-error-alerts.json": errors,
};
for (const [file, wf] of Object.entries(all)) {
  writeFileSync(new URL(`../workflows/${file}`, import.meta.url), JSON.stringify(wf, null, 2) + "\n");
  console.log("wrote", file, wf.nodes.length, "nodes");
}
