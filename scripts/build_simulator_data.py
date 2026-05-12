"""Build docs/simulator-data.json from model outputs in notebooks/data/.

Workflow:
1. Re-run your notebooks to update files in notebooks/data/
2. Run this script: python3 scripts/build_simulator_data.py
3. Commit and push docs/simulator-data.json

The simulator HTML at docs/simulator.html loads this JSON at runtime via fetch.
You never need to edit the HTML to update the model data.
"""
import csv
import json
from pathlib import Path


# Project paths. Resolve relative to this file so it works from any cwd.
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "notebooks" / "data"
OUT_FILE = REPO_ROOT / "docs" / "simulator-data.json"


# ---------------------------------------------------------------------------
# Static config: persona descriptions, default properties, bundles, weights.
# These are hardcoded here (not derived from notebooks) because they describe
# how the personas should be presented to users, which is a product decision
# rather than a model output. Edit these directly if descriptions change.
# ---------------------------------------------------------------------------

PERSONA_DESCRIPTIONS = {
    "emory_grad": {
        "name": "Maya (Emory PhD Candidate)",
        "age": 28,
        "income": "$52,000/year (stipend + RA funding)",
        "savings": "$4,200 liquid",
        "debt": "$580/mo federal student loans",
        "work_destination": "Emory main campus",
        "lease_horizon": "18+ months (through dissertation)",
        "segment": "Budget-constrained academic professional",
        "narrative": (
            "Maya is a third-year PhD candidate in epidemiology. Her monthly take-home is roughly $3,200, "
            "and she's loan-burdened. She's price-sensitive and values stability through her dissertation timeline. "
            "She doesn't have wealth buffers; she lives close to her budget every month."
        ),
    },
    "vahi_professional": {
        "name": "David (Healthcare Consultant)",
        "age": 34,
        "income": "$135K base + $20K bonus = $155K",
        "savings": "$42K HYSA + $185K 401(k)",
        "debt": "$14K residual student loans",
        "work_destination": "Midtown (W. Peachtree), 3 days/week",
        "lease_horizon": "2-3 years",
        "segment": "Mid-career hybrid professional",
        "narrative": (
            "David is a single, well-compensated consultant new to Atlanta. He's not budget-constrained but values "
            "getting his money's worth. Hybrid work means apartment quality matters; he's home 2 days a week. "
            "Likely to upgrade if the value proposition is clear."
        ),
    },
    "empty_nester": {
        "name": "Patricia (Recent Retiree)",
        "age": 67,
        "income": "$180K household (Tom still works as CPA)",
        "savings": "~$1.4M retirement + $815K home-sale proceeds",
        "debt": "None",
        "work_destination": "Sandy Springs (Tom's office)",
        "lease_horizon": "2-4 years (then condo TBD)",
        "segment": "Wealthy empty-nester downsizer",
        "narrative": (
            "Patricia and Tom sold their suburban house and are renting for the first time in 30 years. They have "
            "substantial home-sale proceeds and retirement assets. Price is not a major constraint; they value "
            "quality, security, and the right neighborhood. Tom still commutes, so commute time matters for him."
        ),
    },
    "skeptical_renter_control": {
        "name": "Alex (Software Engineer)",
        "age": 31,
        "income": "$115K",
        "savings": "$35K HYSA + $95K 401(k)",
        "debt": "None",
        "work_destination": "Unspecified",
        "lease_horizon": "1-2 years",
        "segment": "Analytical comparison shopper",
        "narrative": (
            "Alex is an experienced renter in Atlanta who has lived in Midtown, West Midtown, and Decatur. "
            "Reads reviews carefully and will walk away from a bad deal. Anchors the analytical end of the "
            "renter spectrum."
        ),
    },
}

# Default properties shown when the simulator first loads.
HIGHLAND = {
    "Name": "Highland Square (current)",
    "Size": "1,000 SF (large 1BR / compact 2BR)",
    "Price": "$1,950/mo",
    "MoveInSpecial": "1 month free (12-mo lease)",
    "Location": "North Druid Hills / Briarcliff",
    "CommuteToWork": "Average (15-30 min by car)",
    "Walkability": "Walkable Errands (groceries & a few restaurants within a 10-min walk of this building)",
    "Finishes": "Mid-tier (granite/quartz counters, stainless appliances, in-unit washer/dryer)",
    "Parking": "Gated surface lot + reserved space option",
    "Security": "Tier 2: Perimeter gate + controlled-access lobby + camera coverage",
    "Rooftop": "No rooftop space",
    "Coworking": "No dedicated coworking space",
    "PetAmenities": "Standard dog park only",
    "PackageHandling": "Standard mailroom (sign for packages during office hours)",
}

MODERA = {
    "Name": "Modera Morningside (key comp)",
    "Size": "1,000 SF (large 1BR / compact 2BR)",
    "Price": "$2,250/mo",
    "MoveInSpecial": "None",
    "Location": "Virginia-Highland / Morningside",
    "CommuteToWork": "Average (15-30 min by car)",
    "Walkability": "Walk Everywhere (daily errands, dining, transit within a 10-min walk of this building)",
    "Finishes": "Premium (quartz waterfall island, smart thermostat, keyless entry, video doorbell)",
    "Parking": "Dedicated garage with assigned space + EV charging",
    "Security": "Tier 3: Tier 2 + 24/7 staff or virtual concierge + smart locks throughout",
    "Rooftop": "Rooftop lounge with skyline views & outdoor seating",
    "Coworking": "Resident co-working lounge with private call rooms & wifi",
    "PetAmenities": "Dog park + pet spa with grooming station",
    "PackageHandling": "24/7 Amazon Hub lockers + refrigerated grocery locker",
}

DEFAULT_WEIGHTS = {
    "emory_grad": 0.20,
    "vahi_professional": 0.40,
    "empty_nester": 0.20,
    "skeptical_renter_control": 0.20,
}

BUNDLES = {
    "Light renovation (mid-tier finishes + Tier 2 security)": {
        "Finishes": "Mid-tier (granite/quartz counters, stainless appliances, in-unit washer/dryer)",
        "Security": "Tier 2: Perimeter gate + controlled-access lobby + camera coverage",
        "price_bump": 100,
    },
    "Premium repositioning (premium finishes + Tier 3 security + rooftop)": {
        "Finishes": "Premium (quartz waterfall island, smart thermostat, keyless entry, video doorbell)",
        "Security": "Tier 3: Tier 2 + 24/7 staff or virtual concierge + smart locks throughout",
        "Rooftop": "Rooftop lounge with skyline views & outdoor seating",
        "price_bump": 300,
    },
    "Lifestyle pack (coworking + pet spa + smart package)": {
        "Coworking": "Resident co-working lounge with private call rooms & wifi",
        "PetAmenities": "Dog park + pet spa with grooming station",
        "PackageHandling": "24/7 Amazon Hub lockers + refrigerated grocery locker",
        "price_bump": 150,
    },
    "Parking upgrade only (gated garage + EV)": {
        "Parking": "Dedicated garage with assigned space + EV charging",
        "price_bump": 75,
    },
    "Aggressive concession (no other change)": {
        "MoveInSpecial": "2 months free (13-mo lease)",
        "price_bump": 0,
    },
}


# ---------------------------------------------------------------------------
# Build logic. Reads model outputs, combines with static config, writes JSON.
# ---------------------------------------------------------------------------

def load_model_data():
    """Read attributes, persona coefs, and pooled coefs from notebooks/data/."""
    with open(DATA_DIR / "attributes.json", encoding="utf-8") as f:
        attributes = json.load(f)

    with open(DATA_DIR / "persona_coefs.json", encoding="utf-8") as f:
        persona_coefs_raw = json.load(f)

    pooled_rows = []
    with open(DATA_DIR / "pooled_coefs.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pooled_rows.append({"feature": row["feature"], "coef": float(row["coef"])})

    return attributes, persona_coefs_raw, pooled_rows


def validate(persona_coefs_raw):
    """Sanity check: every persona in DEFAULT_WEIGHTS must exist in the coef data
    and every persona with coefs must have a description. Catches drift early."""
    coef_keys = set(persona_coefs_raw.keys())
    desc_keys = set(PERSONA_DESCRIPTIONS.keys())
    weight_keys = set(DEFAULT_WEIGHTS.keys())

    missing_in_coefs = (desc_keys | weight_keys) - coef_keys
    if missing_in_coefs:
        print(f"  WARN: described/weighted but no coefs: {sorted(missing_in_coefs)}")

    missing_in_desc = coef_keys - desc_keys
    if missing_in_desc:
        print(f"  WARN: coefs but no description (will fall back to key as name): {sorted(missing_in_desc)}")

    missing_in_weights = coef_keys - weight_keys
    if missing_in_weights:
        print(f"  WARN: coefs but no default weight (will use 1/N): {sorted(missing_in_weights)}")


def build_payload():
    attributes, persona_coefs_raw, pooled_rows = load_model_data()
    validate(persona_coefs_raw)

    return {
        "ATTRIBUTES": attributes,
        "PERSONA_COEFS_RAW": persona_coefs_raw,
        "POOLED_ROWS": pooled_rows,
        "PERSONA_DESCRIPTIONS": PERSONA_DESCRIPTIONS,
        "HIGHLAND": HIGHLAND,
        "MODERA": MODERA,
        "DEFAULT_WEIGHTS": DEFAULT_WEIGHTS,
        "BUNDLES": BUNDLES,
    }


def main():
    print(f"Reading model data from {DATA_DIR}")
    payload = build_payload()

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    size_kb = OUT_FILE.stat().st_size / 1024
    print(f"Wrote {OUT_FILE} ({size_kb:.1f} KB)")
    print(f"  Personas with coefs: {len(payload['PERSONA_COEFS_RAW'])}")
    print(f"  Attributes: {len(payload['ATTRIBUTES'])}")
    print(f"  Bundles: {len(payload['BUNDLES'])}")
    print()
    print("Next: git add docs/simulator-data.json && git commit && git push")


if __name__ == "__main__":
    main()
