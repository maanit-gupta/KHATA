"""One LIVE end-to-end receipt through the real API (GOAL.md P2.4 AC): a throwaway user and shop,
POST /receipts (the BackgroundTask runs the production OCR with production 2 s polling), then
GET /receipts/{id}. Counts every Sarvam HTTP call, saves the raw log to
tests/fixtures/live/, and deletes the user, shop and files afterwards.

Usage (from backend/):  .venv/bin/python scripts/live_receipt_e2e.py tests/fixtures/receipts/photo_bill.jpg hi-IN
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services import sarvam as sarvam_service  # noqa: E402
from debug_receipt import FIXTURES, Recorder  # noqa: E402
from tests.conftest import Users  # noqa: E402


def main(image_path: str, lang: str) -> None:
    s = sarvam_service.client()
    rec = Recorder(s.client.doc_ai)
    real = s.client

    class ClientProxy:
        doc_ai = rec

        def __getattr__(self, name):
            return getattr(real, name)
    s.client = ClientProxy()

    client = TestClient(app)
    users = Users(client)
    try:
        u = users.with_shop("Live receipt check", lang=lang)
        mime = "image/png" if image_path.endswith(".png") else "image/jpeg"
        up = client.post("/receipts", files={"image": (Path(image_path).name, Path(image_path).read_bytes(), mime)},
                         data={"kind": "supplier", "settled": "false"}, headers=u["headers"])
        print("POST /receipts", up.status_code, up.json())
        got = client.get(f"/receipts/{up.json()['receipt_id']}", headers=u["headers"]).json()
        print("GET /receipts/{id}", json.dumps(got, indent=2))
        filled = sum(got[k] is not None for k in ("vendor_name", "bill_date", "total_paise"))
        print(f"fields filled: {filled}/3   Sarvam HTTP calls: {len(rec.log)}")
        out = FIXTURES / f"receipt_e2e_{datetime.now():%Y%m%d_%H%M%S}_{lang}.json"
        out.write_text(json.dumps({"image": Path(image_path).name, "lang": lang, "receipt": got,
                                   "fields_filled": filled, "sarvam_calls": len(rec.log), "log": rec.log},
                                  indent=2, default=str))
        print("saved", out)
    finally:
        users.cleanup()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
