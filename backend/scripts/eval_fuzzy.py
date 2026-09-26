"""Stretch (GOAL.md): how good are the fuzzy-match thresholds (0.6 / 0.15 / 0.3) on Indian names?

Creates a throwaway user + shop in the live Supabase project, adds ~40 customer names, then runs
the real `find_party` SQL (pg_trgm) + the real `decide_save` rules for spoken variants:
  - same-person variants (how STT might spell a name that's in the book) → should MATCH that party
  - different people with a similar name (not in the book) → should NOT match anyone
Reports precision/recall of "auto-use a party" and how often each case lands on "did you mean",
then deletes everything. No AI calls. Proposals go to DECISIONS.md only; the code is unchanged.

Usage (from backend/): .venv/bin/python scripts/eval_fuzzy.py
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.db import user_client  # noqa: E402
from app.main import app  # noqa: E402
from app.services import llm_router  # noqa: E402
from tests.conftest import Users  # noqa: E402

BOOK = ["Ramesh", "Suresh", "Lakshmi", "Priya", "Mahesh", "Ganesh", "Rajesh", "Dinesh", "Mukesh", "Naresh",
        "Anita", "Sunita", "Kavitha", "Geetha", "Seetha", "Radha", "Meena", "Shanti", "Parvathi", "Saraswathi",
        "Venkatesh", "Srinivas", "Murugan", "Senthil", "Karthik", "Arjun", "Vijay", "Ajay", "Sanjay", "Manoj",
        "Abdul Rahman", "Mohammed Rafi", "Joseph", "Mary", "Fatima", "Gurpreet", "Harpreet", "Balaji Stores",
        "Gupta Traders", "Sharma Kirana"]

# (spoken as STT might write it, the party it means)
SAME = [("Rameshji", "Ramesh"), ("Sureesh", "Suresh"), ("Laxmi", "Lakshmi"), ("Lakshmy", "Lakshmi"),
        ("Priyaa", "Priya"), ("Maheshh", "Mahesh"), ("Ganesha", "Ganesh"), ("Rajes", "Rajesh"),
        ("Dineshh", "Dinesh"), ("Mukeshji", "Mukesh"), ("Anitha", "Anita"), ("Sunitha", "Sunita"),
        ("Kavita", "Kavitha"), ("Gita", "Geetha"), ("Geeta", "Geetha"), ("Sita", "Seetha"), ("Radhaa", "Radha"),
        ("Mina", "Meena"), ("Shanthi", "Shanti"), ("Parvati", "Parvathi"), ("Saraswati", "Saraswathi"),
        ("Venkatesan", "Venkatesh"), ("Srinivasan", "Srinivas"), ("Murugesan", "Murugan"), ("Senthil Kumar", "Senthil"),
        ("Karthick", "Karthik"), ("Arjunji", "Arjun"), ("Vijai", "Vijay"), ("Sanjai", "Sanjay"), ("Manojji", "Manoj"),
        ("Abdul Rehman", "Abdul Rahman"), ("Mohammad Rafi", "Mohammed Rafi"), ("Josef", "Joseph"),
        ("Fathima", "Fatima"), ("Gurprit", "Gurpreet"), ("Balaji Store", "Balaji Stores"),
        ("Gupta Trader", "Gupta Traders"), ("Sharma Kiraana", "Sharma Kirana")]

# Different people (not in the book) whose names are close to someone who is.
OTHER = ["Rakesh", "Naresh Kumar", "Umesh", "Yogesh", "Rupesh", "Brijesh", "Harish", "Girish", "Satish",
         "Ramesh Babu", "Lalitha", "Priyanka", "Anil", "Sunil", "Kavya", "Geethanjali", "Radhika", "Meera",
         "Shantha", "Vijaya", "Ajith", "Sanjeev", "Manish", "Abdul", "Mohan", "Joshua", "Marie", "Farida",
         "Harjeet", "Balu"]


def decide(db, shop_id: str, name: str) -> tuple[str, str | None, float]:
    rows = db.rpc("find_party", {"p_shop": shop_id, "p_query": name, "p_kind": "customer"}).execute().data or []
    parsed = llm_router.ParsedEntry("credit_given", name, 10000, None, None, False, None)
    d = llm_router.decide_save(parsed, rows)
    top = rows[0]["display_name"] if rows else None
    score = float(rows[0]["score"]) if rows else 0.0
    if d.party_action == "use_existing":
        return "use", top, score
    if d.party_action == "ask_did_you_mean":
        return "ask", top, score
    return "new", None, score


def main() -> None:
    client = TestClient(app)
    users = Users(client)
    try:
        u = users.with_shop("Fuzzy eval")
        for n in BOOK:
            client.post("/entries", json={"type": "credit_given", "amount_rupees": 1, "party_name": n}, headers=u["headers"])
        db = user_client(u["token"])
        same = [(s, t, *decide(db, u["shop_id"], s)) for s, t in SAME]
        other = [(s, *decide(db, u["shop_id"], s)) for s in OTHER]
        exact = [decide(db, u["shop_id"], n)[0] for n in BOOK]

        tp = sum(1 for s, t, a, top, _ in same if a == "use" and top == t)
        wrong_use = sum(1 for s, t, a, top, _ in same if a == "use" and top != t)
        fp = sum(1 for s, a, top, _ in other if a == "use")
        precision = tp / (tp + wrong_use + fp) if tp + wrong_use + fp else 1.0
        recall = tp / len(same)
        print(f"exact names auto-matched: {exact.count('use')}/{len(BOOK)}")
        print(f"same-person variants: {Counter(a for _, _, a, _, _ in same)}  (auto-used the right party: {tp})")
        print(f"different people:     {Counter(a for _, a, _, _ in other)}  (silently used someone else: {fp})")
        print(f"auto-use precision {precision:.2f}, recall {recall:.2f}")
        print("\nsame-person variants not auto-matched:")
        for s, t, a, top, sc in same:
            if not (a == "use" and top == t):
                print(f"  {s:18} → {a:3} top={top} score={sc:.2f} (meant {t})")
        print("\ndifferent people that matched someone:")
        for s, a, top, sc in other:
            if a != "new":
                print(f"  {s:18} → {a:3} top={top} score={sc:.2f}")
    finally:
        users.cleanup()


if __name__ == "__main__":
    main()
