// Code node: "Normalise enquiry"
// Accepts a website form, Typeform/Tally, or forwarded email payload and
// returns one clean shape, so every later step can rely on it.
const out = [];
for (const item of $input.all()) {
  const b = item.json.body ?? item.json;
  const pick = (...keys) => keys.map((k) => b[k]).find((v) => v !== undefined && String(v).trim() !== "");
  const email = String(pick("email", "Email", "from_email", "reply_to") ?? "").trim().toLowerCase();
  const phone = String(pick("phone", "Phone", "tel", "whatsapp") ?? "").replace(/[^\d+]/g, "");
  const message = String(pick("message", "Message", "text", "body_plain", "comments") ?? "").trim();
  out.push({
    json: {
      id: `ENQ-${Date.now().toString(36).toUpperCase()}-${out.length}`,
      receivedAt: new Date().toISOString(),
      source: String(pick("source", "form_name") ?? "website"),
      name: String(pick("name", "Name", "full_name", "from_name") ?? "").trim(),
      email,
      phone,
      message: message.slice(0, 4000),
      valid: Boolean(message) && (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length >= 8),
    },
  });
}
return out;
