# Real-material harness report

- Run: 2026-09-26 22:59 IST
- Voice material: **synthetic (Sarvam TTS clips) (carried over from the previous run)** · Bill material: **synthetic (Chromium-rendered bills)**
- Path: the FastAPI app itself (POST /voice/entry; POST /receipts + BackgroundTask; GET /receipts/{id}), live Sarvam + Groq, throwaway users in a throwaway shop (deleted afterwards).
- Live calls this run: Sarvam **21**, Groq **0** (every HTTP attempt, status polls included). The carried-over half cost Sarvam 42, Groq 6 in its own run.

## Thresholds

| Measure | Result | Threshold | Pass |
|---|---|---|---|
| Voice: correct amount | 100% | ≥ 80% | yes |
| Voice: correct party | 100% | ≥ 70% | yes |
| Voice: correct type | 100% | ≥ 80% | yes |
| Bills: correct total | 100% | ≥ 70% | yes |
| Example echoes (a result equal to a prompt/schema/demo example instead of the input) | 0 | 0 | yes |

## Voice

| File | Lang | What was said | Raw STT (exactly as returned) | Parsed type · party · ₹ | Decision | Read-back (spoken) | Amount | Party | Type |
|---|---|---|---|---|---|---|---|---|---|
| clip1_hi-IN.mp3 | hi-IN | गुरदीप को 2600 रुपये उधार दिए | “Gurdeep was given ₹2600 as a loan.” | credit_given · Gurdeep · 2600 | auto | Gurdeep, 2,600 rupees उधार लिए, save कर लिए। | ✓ | ✓ | ✓ |
| clip2_hi-IN.mp3 | hi-IN | कुसुम ने 1745 रुपये वापस दिए | “Kusum returned 1745 rupees.” | payment_received · Kusum · 1745 | auto | Kusum, 1,745 rupees payment receive हुआ, saved. | ✓ | ✓ | ✓ |
| clip3_ta-IN.mp3 | ta-IN | பல்லவி அவர்களுக்கு 1275 ரூபாய் கடன் கொடுத்தேன் | “I gave Pallavi a loan of one thousand two hundred and seventy-five rupees.” | credit_given · Pallavi · 1275 | auto | Pallavi, 1,275 rupees எடுத்துக்கிட்டாங்க, save பண்ணிட்டாங்க. | ✓ | ✓ | ✓ |
| clip4_ta-IN.mp3 | ta-IN | இன்று 2840 ரூபாய் ரொக்க விற்பனை | “Today, the sale of money is two thousand eight hundred and forty rupees.” | cash_sale · — · 2840 | auto | 2,840 rupees cash sale, save ஆயிடுச்சு. | ✓ | ✓ | ✓ |
| clip5_en-IN.mp3 | en-IN | Bought stock from Selvi for 365 rupees on credit | “Bought stock from Selvi for ₹365 on credit.” | purchase_credit · Selvi · 365 | auto | Selvi, 365 rupees purchase on credit, saved. | ✓ | ✓ | ✓ |
| clip6_en-IN.mp3 | en-IN | Paid 2470 rupees for the electricity bill | “Paid ₹2470 for the electricity bill.” | expense · electricity bill · 2470 | auto | 2,470 rupees expense, saved. | ✓ | ✓ | ✓ |

Read-back audio: `artifacts/harness/readback_<clip>.mp3`.

## Bills

| File | Kind | Expected vendor · date · total | Got vendor · date · total | Total check | Retried in English | Total | Vendor | Date |
|---|---|---|---|---|---|---|---|---|
| bill1_printed.png | supplier | Sagar Kirana Supply · 2026-09-13 · 2308.00 | SAGAR KIRANA SUPPLY · 2026-09-13 · 2,308.00 | ok | False | ✓ | ✓ | ✓ |
| bill2_photo.jpg | supplier | Nandini Agencies · 2026-09-20 · 2464.00 | NANDINI AGENCIES · 2026-09-20 · 2,464.00 | ok | False | ✓ | ✓ | ✓ |
| bill3_hindi.png | expense | Parvat Distributors · 2026-09-14 · 1225.00 | Parvat Distributors (किराना) · 2026-09-14 · 1,225.00 | ok | False | ✓ | ✓ | ✓ |

### What the OCR read (raw Digitise text, per bill)

<details><summary>bill1_printed.png</summary>

```
SAGAR KIRANA SUPPLY
Main Bazaar, Ward 7
Bill No. 4137 Date 13/09/2026
Item | Qty | Rate | Amount
Sunflower oil 1L | 6 | 240.00 | 1,440.00
Rice 25kg | 1 | 232.00 | 232.00
Soap | 12 | 53.00 | 636.00
GRAND TOTAL |  |  | 2,308.00
Thank you. Visit again.
```

</details>

<details><summary>bill2_photo.jpg</summary>

```
NANDINI AGENCIES
Main Bazaar, Ward 7
Bill No. 4207 | Date 20/09/2026
Item | Qty | Rate Amount
Soap | 12 | 81.00 972.00
Rice 25kg | 1 | 132.00 132.00
Tea 500g | 4 | 340.00 1,360.00
GRAND TOTAL | 2,464.00
Thank you. Visit again.
```

</details>

<details><summary>bill3_hindi.png</summary>

```
Parvat Distributors (किराना)
मेन बाज़ार, वार्ड 7
सामान | मात्रा | दर | रकम
Soap | 12 | 41.00 | 492.00
Rice 25kg | 1 | 303.00 | 303.00
Toor dal | 5 | 86.00 | 430.00
कुल योग | 1,225.00
धन्यवाद
```

</details>

## Misses

None.

## Example echoes

None.
