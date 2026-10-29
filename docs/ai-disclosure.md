# AI disclosure

## Summary

The in-app assistant is a **deterministic rules engine**. It does not call an external AI model, does
not send business data to a third party, does not learn and does not generate free-form advice. The
API reports `engine: "RULES_ENGINE"` and `generatedBy: "RULES_ENGINE"` on every answer.

No `AI_PROVIDER`, API key or model configuration exists in this repository. The only outbound
network calls are to PostgreSQL and Redis inside the deployment.

## What it can answer

`GET /assistant/capabilities` returns the current list. It recognises a fixed set of commerce
intents, using keyword and period parsing:

| Intent | Example | Source |
| --- | --- | --- |
| Sales summary | "How much did we sell today?" | Completed sales, refunds, discounts |
| Profit explanation | "Why did profit change this month?" | Current vs previous period aggregates |
| Top products | "What are my top products this week?" | Sale lines |
| Reorder / low stock | "Which products should I reorder?" | Inventory levels, reorder points |
| Cashier performance | "Who is my best cashier this month?" | Sales by cashier |
| Refunds | "How much did we refund last month?" | Completed refunds |
| Discounts | "Which discounts did we give this week?" | Sale and line discounts |
| Suppliers / purchases | "Which supplier did we buy most from?" | Received purchases |
| Tax | "How much tax is due this month?" | Tax recorded on sales net of refunds |
| Branches | "Which branch performed best?" | Sales by location |
| Customers | "Who are my repeat customers?" | Recorded customers and sales |

Periods understood: today, yesterday, this/last week, this/last month, "last N days" (1–365), and a
default of the last 30 days. Branch scoping follows the same rules as reports. The engine requires
the `assistant:use` and `analytics:read` permissions, so cashiers and inventory clerks cannot use it.

If a question contains no commerce terms, or maps to no intent, the assistant returns the capability
list and suggestions rather than inventing an answer.

## How an answer is produced

1. Parse the question for a period and one of the known intents.
2. Run the same SQL/reporting code the reports module uses, scoped to the caller's `businessId` and
   permitted branch.
3. Format a short text answer and a `metrics` object with the underlying numbers and labels.
4. Return suggestions for related questions.

The result is reproducible for the same data and question. There is no randomness, prompt, model
temperature or hidden context.

## Data handling and privacy

- Input: the question text, the authenticated user and optional branch.
- Data read: only the caller's tenant records needed for the chosen intent.
- Output: answer text, metrics and suggestions, returned to the caller.
- The assistant does not create, update or delete business records.
- Questions and answers are not stored in a conversation table. Standard request logging records
  method, path, status, duration, request ID, user ID and business ID — not the question text.
- No external provider receives the question, records or metrics. No data is used for training.
- Audit logging covers business mutations, not assistant questions.

## Limitations and human oversight

- It answers only recorded data. Sales never entered, stock never received or refunds never recorded
  are invisible to it.
- It cannot browse the web, read documents, generate images or write code.
- Tax and profit figures are bookkeeping aids, not filed returns or audited financial statements.
  A qualified person must review statutory filings.
- The intent parser is literal. Unusual phrasing may fall back to sales or the capability list.
- It is not a chatbot and keeps no memory between requests.
- Management decisions remain with the user; the assistant provides computed context only.

## If an LLM is added later

Any future integration must, at minimum:

1. be disclosed accurately in this document and in the UI;
2. send only the minimum tenant data required, with a data-processing agreement and retention policy;
3. never present model output as a confirmed financial record;
4. keep the rules-based path available for deterministic, auditable figures;
5. add prompt-injection, data-exfiltration and tenant-isolation tests.

Until then, no claim of "AI-powered" analysis should be made beyond the rules engine described here.
