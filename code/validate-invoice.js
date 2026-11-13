// Code node: "Validate invoice"
// Checks the numbers Claude extracted before anything reaches the books.
// Anything that doesn't add up goes to a review queue instead.
const round = (n) => Math.round(Number(n) * 100) / 100;
return $input.all().map((item) => {
  let inv = {};
  try {
    const text = (item.json.content ?? []).find((c) => c.type === "text")?.text ?? "{}";
    inv = JSON.parse(text);
  } catch {
    inv = {};
  }
  const problems = [];
  for (const f of ["supplier", "invoice_number", "invoice_date", "total", "currency"]) {
    if (inv[f] === undefined || inv[f] === null || inv[f] === "") problems.push(`missing ${f}`);
  }
  if (inv.net !== undefined && inv.vat !== undefined && inv.total !== undefined) {
    const diff = Math.abs(round(inv.net) + round(inv.vat) - round(inv.total));
    if (diff > 0.02) problems.push(`net + VAT ≠ total (off by ${diff.toFixed(2)})`);
  }
  if (Array.isArray(inv.lines) && inv.lines.length && inv.net !== undefined) {
    const sum = inv.lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    if (Math.abs(round(sum) - round(inv.net)) > 0.02) problems.push(`line items sum to ${round(sum)}, net is ${round(inv.net)}`);
  }
  if (inv.invoice_date && isNaN(Date.parse(inv.invoice_date))) problems.push("unreadable date");
  if (Number(inv.total) <= 0) problems.push("total is not positive");
  return {
    json: {
      supplier: inv.supplier ?? "",
      invoice_number: inv.invoice_number ?? "",
      invoice_date: inv.invoice_date ?? "",
      due_date: inv.due_date ?? "",
      currency: inv.currency ?? "",
      net: inv.net ?? "",
      vat: inv.vat ?? "",
      total: inv.total ?? "",
      line_count: Array.isArray(inv.lines) ? inv.lines.length : 0,
      ok: problems.length === 0,
      problems: problems.join("; "),
      processed_at: new Date().toISOString(),
    },
  };
});
