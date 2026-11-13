// Code node: "Yesterday's numbers"
// Turns yesterday's rows from the Leads sheet into counts the summary can quote.
const now = new Date();
const start = new Date(now); start.setDate(now.getDate() - 1); start.setHours(0, 0, 0, 0);
const end = new Date(start); end.setDate(start.getDate() + 1);
const rows = $input.all().map((i) => i.json).filter((r) => {
  const t = Date.parse(r.receivedAt);
  return t >= start.getTime() && t < end.getTime();
});
const count = (key) => rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {});
const urgentOpen = rows.filter((r) => r.urgency === "high" && String(r.status || "").toLowerCase() !== "done");
return [{
  json: {
    date: start.toISOString().slice(0, 10),
    total: rows.length,
    byCategory: count("category"),
    bySource: count("source"),
    urgentOpen: urgentOpen.map((r) => ({ id: r.id, name: r.name, summary: r.summary })),
    spam: rows.filter((r) => r.category === "spam").length,
  },
}];
