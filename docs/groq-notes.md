# Groq notes (verified 2026-09-26)

Sources: console.groq.com/docs (fetched live today) and the installed SDK **`groq==1.7.0`**.

## Models used by `llm_router.py`

| Constant | Model | Needed for | Verified |
|---|---|---|---|
| `PARSE_MODEL` | `openai/gpt-oss-20b` | strict `json_schema` (parse_entry), plain text (narrate_insights) | ✅ Listed under "Models with Strict Mode (`strict: true`)" |
| `QA_MODEL` | `openai/gpt-oss-120b` | tool calling (answer) | ✅ "Local & Remote Tool Use Support: Yes" |

- Both models support Tool Use, JSON Object Mode, JSON Schema Mode, and Reasoning, with a
  131,072-token context and 65,536 max output tokens.
- **Neither model is on the deprecations page** (the only current entry is llama-3.3-70b-versatile,
  shut down 2026-08-16).
- Docs: https://console.groq.com/docs/model/openai/gpt-oss-20b ·
  https://console.groq.com/docs/model/openai/gpt-oss-120b · https://console.groq.com/docs/deprecations

## Structured outputs (strict)
- "The following models support `strict: true`, which uses constrained decoding to guarantee
  schema-compliant output: `openai/gpt-oss-20b`, `openai/gpt-oss-120b`."
- Strict requirements: **every property is `required`** and **every object sets
  `additionalProperties: false`**. Optional values use a union with null, e.g. `"type": ["string", "null"]`.
  Supported: string/number/boolean/integer, object/array/enum, and anyOf.
- `ENTRY_SCHEMA` in `llm_router.py` meets all of these. ✅
- **"Streaming and tool use are not currently supported with Structured Outputs."** This confirms
  the router's reason for splitting parse and Q&A across two calls. ✅
- Docs: https://console.groq.com/docs/structured-outputs

## Tool use
- The gpt-oss-20b and gpt-oss-120b rows both read: local and remote tool use **Yes**, **parallel tool use No**,
  JSON mode Yes, built-in tools Yes.
  → Expect one tool call per turn. `answer()` loops over `msg.tool_calls`, which works either way,
  and `MAX_TOOL_ROUNDS = 4` bounds the turns (find_party → get_party_balance takes 2).
- `ChatCompletionMessageToolCall` fields in SDK 1.7.0: `id`, `function`, `type`. So
  `tc.model_dump()` round-trips cleanly as an assistant `tool_calls` entry. ✅
- Docs: https://console.groq.com/docs/tool-use/overview

## Reasoning (gpt-oss)
- gpt-oss does **not** support `reasoning_format`. Reasoning comes back in `message.reasoning` by default,
  and `include_reasoning=False` drops it. `reasoning_effort`: low | medium | high.
- `message.content` stays the clean answer or JSON, so `json.loads(resp.choices[0].message.content)` in
  `parse_entry` is correct. The router doesn't set `reasoning_effort` or `include_reasoning`, and I will
  leave them unset because the logic can't change.

## SDK behaviour that affects the build
- `Groq()` **raises `GroqError` at construction if `GROQ_API_KEY` is unset**. `llm_router.py` builds
  the client at import time (`groq = Groq()`), so importing the module needs the env var.
  Tests set a dummy key, and the logic stays untouched.
- `Groq(max_retries=...)` **defaults to 2 built-in retries**. CLAUDE.md §8 wants 3 tries with 1/2/4 s backoff.
  To stay out of the router's logic, the backend wraps calls in its own retry and sets
  `llm_router.groq = Groq(max_retries=0)` at startup (an open question at Checkpoint A).
