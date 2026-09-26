# Read-back samples: which translation sounds right?

For a native Hindi and Tamil speaker (NEEDS_HUMAN N-009). Each MP3 speaks the same three read-backs:

1. Ishaan, 2,470 rupees udhaar, saved.
2. Meera, 6,300 rupees payment received. Tap confirm to save.
3. Dev owes you 1,25,000 rupees, the most of anyone.

Sarvam calls used: 28. The app currently uses **mayura-colloquial** for every language (`backend/app/constants.py` → `TRANSLATE`).

## hi-IN · mayura-colloquial (`mayura:v1`, mode `modern-colloquial`, voice `shubh`)

Audio: `artifacts/tts-compare/hi-IN_mayura-colloquial.mp3`

1. Ishaan, 2,470 rupees उधार, saved. — number guard: pass
2. Meera, 6,300 rupees payment receive हो गया। Save करने के लिए confirm कीजिए। — number guard: pass
3. Dev ने आपको 1,25,000 rupees owe किए हैं, सबसे ज़्यादा। — number guard: pass

Pronunciation check (the clip fed back through speech-to-text): “Ishan, two thousand four hundred seventy rupees credit saved. My six thousand three hundred rupees payment has been received. Confirm to save. Dev has owed you one lakh twenty-five thousand rupees, the most.” → amounts all heard correctly.

## hi-IN · mayura-formal (`mayura:v1`, mode `formal`, voice `shubh`)

Audio: `artifacts/tts-compare/hi-IN_mayura-formal.mp3`

1. ईशान, 2,470 रुपये उधार लिए हुए, बचा लिए गए। — number guard: pass
2. मीरा, 6,300 रुपये का भुगतान प्राप्त हुआ। सहेजने के लिए पुष्टि करें पर टैप करें। — number guard: pass
3. देव, आपसे 1,25,000 रुपये अधिक बकाया है। — number guard: pass

## hi-IN · sarvam-translate (`sarvam-translate:v1`, mode `formal`, voice `shubh`)

Audio: `artifacts/tts-compare/hi-IN_sarvam-translate.mp3`

1. ईशान, 2,470 रुपये उधार, बचा लिया। — number guard: pass
2. मीरा को 6,300 रुपये का भुगतान प्राप्त हुआ। सहेजने के लिए टैप करके पुष्टि करें। — number guard: pass
3. देव पर आपका 1,25,000 रुपये बकाया है, जो किसी भी व्यक्ति से सबसे अधिक है। — number guard: pass

Pronunciation check (the clip fed back through speech-to-text): “Ishan saved two thousand four hundred seventy rupees on credit. Meera received a payment of six thousand three hundred rupees. Tap to confirm for ease. You have one lakh twenty-five thousand rupees outstanding on Dev, which is the highest amount for any person.” → amounts all heard correctly.

## ta-IN · mayura-colloquial (`mayura:v1`, mode `modern-colloquial`, voice `ratan`)

Audio: `artifacts/tts-compare/ta-IN_mayura-colloquial.mp3`

1. Ishaan, 2,470 rupees எடுத்துக்கிட்டாரு, save பண்ணிட்டாரு. — number guard: pass
2. Meera, 6,300 rupees payment receive ஆகிடுச்சு. Save பண்ண confirm பண்ணுங்க. — number guard: pass
3. Dev உங்களுக்கு 1,25,000 rupees கடன் பட்டிருக்காரு. — number guard: pass

Pronunciation check (the clip fed back through speech-to-text): “Ishan took 2470 rupees and saved it. Meera received 6300 rupees payment. Confirm to save. Dev owes you 125,000 rupees.” → amounts all heard correctly.

## ta-IN · mayura-formal (`mayura:v1`, mode `formal`, voice `ratan`)

Audio: `artifacts/tts-compare/ta-IN_mayura-formal.mp3`

1. ஈசான், இரண்டு ஆயிரத்து நாநூறு ரூபாய் கடன் வாங்கியிருக்கிறேன், சேமித்து வைத்திருக்கிறேன். — number guard: FAIL (would fall back to English)
2. மீரா, 6,300 ரூபாய் பணம் வந்து சேர்ந்தது. உறுதிப்படுத்துங்கள் என்பதைத் தட்டவும். — number guard: pass
3. தேவ், நீங்கள் அனைவரையும் விட 1,25,000 ரூபாய் அதிகமாகச் செலுத்தவேண்டும். — number guard: pass

## ta-IN · sarvam-translate (`sarvam-translate:v1`, mode `formal`, voice `ratan`)

Audio: `artifacts/tts-compare/ta-IN_sarvam-translate.mp3`

1. இஷான், 2,470 ரூபாய் கடன், சேமிக்கப்பட்டது. — number guard: pass
2. மீராவுக்கு 6,300 ரூபாய் பணம் வந்துள்ளது. சேமிக்க டேப்பை உறுதிப்படுத்தவும். — number guard: pass
3. தேவ் உங்களுக்கு 1,25,000 ரூபாய் தர வேண்டும், இது மற்றவர்களை விட அதிகம். — number guard: pass

Pronunciation check (the clip fed back through speech-to-text): “Ishan, a loan of 2470 rupees has been saved. Meera has received 6300 rupees. Confirm the savings data. Dev needs to give you 125,000 rupees. This is more than others.” → amounts all heard correctly.

## Notes from the machine check (not a native speaker's judgement)

- Bulbul said every amount correctly in both languages: fed back through speech-to-text, all four checked clips returned 2470, 6300 and 1,25,000 (Hindi STT writes them as words, e.g. "one lakh twenty-five thousand"). Amounts are already spoken with Indian digit grouping ("1,25,000"), so no extra pre-formatting is needed.
- Tamil, Mayura formal, sentence 1 dropped "seventy" (2,470 became "இரண்டு ஆயிரத்து நாநூறு", 2,400). The number guard catches this and the app would speak that line in English instead.
- Mayura colloquial (the current setting) keeps English words inside the sentence ("payment receive हो गया", "save பண்ணிட்டாரு"). sarvam-translate is fully in the native script.
- Possible wrong senses to listen for: formal Hindi "बचा लिए गए" reads like "rescued" for "saved"; formal Tamil "கடன் வாங்கியிருக்கிறேன்" reads like "I borrowed" (the opposite direction of udhaar).

To switch a language, set its entry in `TRANSLATE` in `backend/app/constants.py`, e.g. `TRANSLATE["ta-IN"] = {"model": "sarvam-translate:v1", "mode": "formal"}`.
