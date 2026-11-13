// Code node: "Parse AI triage"
// Joins Claude's structured answer back onto the original enquiry and applies
// business rules on top, so a model mistake can't silently drop a hot lead.
const enquiries = $("Normalise enquiry").all();
return $input.all().map((item, i) => {
  const enquiry = enquiries[i].json;
  let ai = {};
  try {
    const text = (item.json.content ?? []).find((c) => c.type === "text")?.text ?? "{}";
    ai = JSON.parse(text);
  } catch (e) {
    ai = { category: "other", urgency: "normal", summary: "AI triage failed, check manually", needs_review: true };
  }
  const categories = ["new_customer", "quote_request", "booking", "complaint", "support", "spam", "other"];
  const category = categories.includes(ai.category) ? ai.category : "other";
  // Hard rules beat the model: complaints and anything mentioning money back are always urgent.
  const urgent = ai.urgency === "high" || category === "complaint" || /refund|chargeback|lawyer|cancel/i.test(enquiry.message);
  return {
    json: {
      ...enquiry,
      category,
      urgency: urgent ? "high" : ai.urgency === "low" ? "low" : "normal",
      language: ai.language ?? "en",
      summary: ai.summary ?? "",
      draft_reply: ai.draft_reply ?? "",
      needs_review: Boolean(ai.needs_review) || category === "other",
      is_spam: category === "spam",
    },
  };
});
