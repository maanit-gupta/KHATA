# Sarvam API notes (verified 2026-09-26)

Sources: the Sarvam docs MCP server (`https://docs.sarvam.ai/_mcp/server`, tool `searchDocs`),
the raw reference pages (append `.md` to any docs URL), and introspection of the installed
SDK **`sarvamai==0.1.34`** (the latest on PyPI today). Signatures below are copied from the SDK.

## Client

```python
from sarvamai import SarvamAI
from sarvamai.core.api_error import ApiError        # .status_code, .body
client = SarvamAI(api_subscription_key=os.environ["SARVAM_API_KEY"])
```
- Auth header on the wire: `api-subscription-key`.
- **The SDK retries by itself** (`max_retries` defaults to 2 in `core/http_client.py`).
  CLAUDE.md §8 wants exactly 3 tries at 1 s / 2 s / 4 s, so every call passes
  `request_options={"max_retries": 0}` and our own backoff wrapper retries 429/503.
- Error body: `{"error": {"request_id", "message", "code"}}`; codes include
  `rate_limit_exceeded_error`, `insufficient_quota_error`, `invalid_api_key_error`.
- Docs: https://docs.sarvam.ai/api/getting-started/errors-troubleshooting

## 1. Speech-to-text, translate mode (`POST /speech-to-text`)

```python
resp = client.speech_to_text.transcribe(
    file=("note.webm", audio_bytes, "audio/webm"),   # IO | bytes | (name, bytes, mime)
    model="saaras:v3",           # 'saaras:v3' (default, recommended) | 'saaras:v4' (latest)
    mode="translate",            # 'transcribe'|'translate'|'verbatim'|'translit'|'codemix'
    language_code="ta-IN",       # the user's lang; 'unknown' = auto-detect
    # with_timestamps, input_audio_codec (needed only for raw PCM), keyterms (v4 only, ≤50)
    request_options={"max_retries": 0},
)
resp.transcript        # str: English text
resp.language_code     # str | None: detected source language
resp.request_id        # str | None
```
- Formats: WAV, MP3, AAC, AIFF, OGG, OPUS, FLAC, MP4/M4A, AMR, WMA, **WebM**, PCM.
  So Chrome WebM/Opus and Safari MP4 can be sent as-is (CLAUDE.md §6.1). ✅
- The REST endpoint is for audio **under 30 s**, which matches our 30 s cap. Longer audio needs the Batch API.
- The reference page says `mode` is "only applicable when using saaras:v3". The model
  description also says v4 supports all modes. **Default choice: `saaras:v3`.**
- Docs: https://docs.sarvam.ai/api-reference/speech-to-text/transcribe ·
  https://docs.sarvam.ai/api/getting-started/models/saaras

## 2. Text translation (`POST /translate`)

```python
resp = client.text.translate(
    input=answer_en,
    source_language_code="en-IN",            # or 'auto' (mayura only)
    target_language_code="ta-IN",
    model="mayura:v1",                       # 'mayura:v1' | 'sarvam-translate:v1'
    mode="modern-colloquial",                # mayura: formal|modern-colloquial|classic-colloquial|code-mixed
    numerals_format="international",         # 'international' (0-9, default) | 'native'
    # speaker_gender: 'Male'|'Female'; output_script: 'roman'|'fully-native'|'spoken-form-in-native'
    request_options={"max_retries": 0},
)
resp.translated_text, resp.source_language_code, resp.request_id
```
- **Numerals option exists: `numerals_format="international"`**, and both models support it.
  It is already the default, but we pass it explicitly (CLAUDE.md §2).
- Input limits: **1000 chars for mayura:v1**, 2000 for sarvam-translate:v1. Q&A answers are
  two short sentences, so this is fine. Narrations must stay under 1000 characters.
- sarvam-translate:v1 supports formal mode only. All six of our languages work with both models.
- Docs: https://docs.sarvam.ai/api-reference/text/translate-text ·
  https://docs.sarvam.ai/api/getting-started/models/mayura

## 3. Text-to-speech, Bulbul v3 (`POST /text-to-speech`)

```python
resp = client.text_to_speech.convert(
    text=reply_local,                 # bulbul:v3 max 2500 chars
    language_code="ta-IN",
    model="bulbul:v3",
    speaker="ratan",                  # lowercase; default 'shubh'
    pace=1.0,                         # v3: 0.5–2.0
    speech_sample_rate=24000,         # 8000|16000|22050|24000|32000|44100|48000
    output_audio_codec="mp3",         # mp3|linear16|mulaw|alaw|opus|flac|aac|wav (default wav)
    temperature=0.6,                  # v3 only
    request_options={"max_retries": 0},
)
resp.audios   # List[str]: base64 audio, one per input text → our `audio_b64` = resp.audios[0]
```
- `pitch`, `loudness`, and `enable_preprocessing` are **not supported on v3**.
- Numbers longer than 4 digits should carry commas ("10,000") for correct pronunciation.
  The number guard strips commas before comparing, so this is safe.
- Romanised Indic input degrades output badly, so always send native script.
- bulbul:v3 speakers (all usable in every language): shubh (default), aditya, ritu, priya, neha,
  rahul, pooja, rohan, simran, kavya, amit, dev, ishita, shreya, ratan, varun, manan, sumit, roopa,
  kabir, aayan, ashutosh, advait, anand, tanya, tarun, sunny, mani, gokul, vijay, shruti, suhani,
  mohit, kavitha, rehan, soham, rupali. (varun is flagged as a "villain" voice; don't offer it.)

**Recommended speakers per language** (Sarvam's CER-ranked table, best-practices §10):

| Lang | Male | Female |
|---|---|---|
| ta-IN | ratan, rohan | ishita, ritu |
| hi-IN | shubh, ashutosh | priya, suhani |
| en-IN | ratan | ishita |
| te-IN | shubh, ratan | neha, priya |
| kn-IN | shubh, ratan | neha, ishita |
| ml-IN | shubh | pooja |

- Docs: https://docs.sarvam.ai/api-reference/text-to-speech/convert ·
  https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/best-practices ·
  https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/voices

## 4. Document AI, Extract (receipts)

"Document AI" (Sarvam Vision 1.5, namespace `doc_ai`) **supersedes the older Document
Intelligence API**, which is now under `/api-reference/legacy/`. It has two endpoints:
`digitise` (full OCR) and **`extract` (schema-based fields), which is what we need**.
There is **no separate create/upload/start step any more**: `extract()` creates the job,
uploads the file, and starts processing in one call.

```python
job = client.doc_ai.extract(
    file=[("bill.jpg", image_bytes, "image/jpeg")],   # a LIST of files
    schema=json.dumps(RECEIPT_SCHEMA),               # JSON *string*; exactly one of schema | config_id
    language="ta-IN",                                # NOTE: `language`, not `language_code`
    output_format="json",                            # 'json' | 'csv' | 'xlsx'
    # upload_ids, config_id, classification, model are also accepted
    request_options={"max_retries": 0},
)
job.job_id, job.status, job.run_id                   # DocAiStartJobResponse

st = client.doc_ai.get_status(job.job_id)            # poll every 2 s (CLAUDE.md), 90 s timeout
st.status   # pending | running | completed | partially_completed | failed | rejected
st.usage    # pages_total, pages_processed, pages_succeeded, pages_failed

res = client.doc_ai.get_results(job.job_id)          # only after a terminal state, else HTTP 409
res.result        # Dict[str, Any] → {"vendor_name": ..., "bill_date": ..., "total": ...}
res.annotations   # Dict[str, Any] (per-field extras, e.g. confidence)
res.type == "extract"; res.job_id; res.status; res.usage; res.version
```
Wire endpoints: `POST /doc-ai/v1/job/extract`, `GET /doc-ai/v1/job/{id}/status`,
`GET /doc-ai/v1/job/{id}/results`.

**Schema rules:** the root must be `type: "object"` with non-empty `properties`. **Every field needs a
`type` and a non-empty `description`.** Allowed types: string, number, integer, boolean,
object, array (**no `date` type** in the API; use string). Max nesting depth is 4. Planned schema:
```json
{"type":"object","properties":{
  "vendor_name":{"type":"string","description":"Name of the shop or business that issued the bill, as printed at the top"},
  "bill_date":{"type":"string","description":"Bill date as printed"},
  "total":{"type":"number","description":"Final amount payable in INR (grand total after taxes), as a number"}}}
```
- Inputs: JPG/PNG/PDF (≤10 pages)/ZIP. Max 200 MB (the dashboard caps at 50 MB).
- **Rate limit: 10 requests/minute on all plans.** Each receipt costs 1 extract call plus polling
  calls; it is unclear whether status polls count toward the limit (see Checkpoint A).
- Errors: 400 bad schema or >10 pages · 402/403 billing · 409 results requested too early · 413 too large ·
  422 bad file · 429 rate limit · 503.
- `raw_extract` will store `res.model_dump()` (result + annotations + usage).
- Docs: https://docs.sarvam.ai/api/api-guides-tutorials/document-intelligence/overview ·
  https://docs.sarvam.ai/docai/how-to/extract-fields-from-a-document/extract-structured-fields ·
  https://docs.sarvam.ai/api/getting-started/models/sarvam-vision
