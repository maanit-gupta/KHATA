# DEMO.md: a 3-minute demo

**Before you start (5 minutes ahead):**
- Open `https://<render-service>/health` to wake the free backend (DEPLOY.md §2). The app says
  "Waking the server…" if you forget.
- Log in on a phone-sized window with a shop that has a few entries
  (`backend/.venv/bin/python scripts/seed_demo.py you@example.com` adds 6 parties and 15 entries).
  Set your language to Hindi in Settings.
- Have a printed bill on the table.
- Keep `/demo` open in a second tab. It runs entirely in the browser with canned voice and OCR, so
  it is the fallback for any step if the network or a service fails.

| Time | Do | Say | If it fails |
|---|---|---|---|
| 0:00 | Show the landing page `/`. | "Kirana shops keep a paper khata. Khata keeps it by voice, in six Indian languages." | Skip straight to the ledger. |
| 0:20 | Ledger. **Hold to add**, say *"Ramesh ko 250 udhaar diya"*, release. | "I hold, say it, let go. It's saved and read back in Hindi, and I get 5 seconds to undo." | "Service busy": say it again after a few seconds. No network: switch to the `/demo` tab and hold ADD there (canned "Ramesh, ₹250"). |
| 0:45 | Tap **Undo** before the white line runs out. Then say *"Ramesh ko 6000 udhaar diya"*. | "Undo means void, never delete. Anything over ₹5,000 waits for a tap." Tap **Confirm**. | In `/demo`, the third hold is the ₹6,000 case. |
| 1:10 | Say *"Rakesh ko 100 diya"* (only Ramesh exists). | "Close names never create a duplicate. It asks: did you mean Ramesh?" Tap **Yes, Ramesh**. | If it matched straight away, the name was clear enough; move on. |
| 1:30 | **Hold to ask**: *"Ramesh kitna dena hai?"* | "The answer is read from the database. The model only phrases it, and it can't say a number the database didn't give it." | If the answer is the "could not answer" line, the guard refused a number; ask again, or show the party page. |
| 1:55 | **Scan a bill** → Supplier → Credit → photograph the bill. | "Sarvam reads the vendor, date and total in the background. I can fix anything before saving." Change the total, **Save entry**. | If the fields stay empty (a hard bill), type them in: "unreadable bills go to the review queue, nothing is guessed." `/demo` fills them every time. |
| 2:25 | **Parties** → the supplier → balance "YOU OWE ₹…". Tap **→** on the entry. | "Every entry keeps its evidence: the recording or the bill photo." | Show the recording ▶ on Ramesh instead. |
| 2:40 | **Review** (the cyan count). **Keep as is** on the new supplier. | "Everything the app wasn't sure about lands here." | Skip. |
| 2:50 | Back to **Ledger**: "This week, so far." ▶ | "A weekly summary from the same numbers, spoken in your language." | Read the card aloud. |
| 3:00 | End. | "Voice in, numbers from the database, nothing ever deleted." | |

**Things not to promise:** payment reminders, WhatsApp, offline use, GST, or line items (all out
of scope). Handwritten-bill accuracy hasn't been measured (NEEDS_HUMAN N-005).
