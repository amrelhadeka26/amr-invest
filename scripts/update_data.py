"""Daily data refresh for the Grow page.

Runs from GitHub Actions. Updates the US dollar rate in grow/data.json once a day,
at 8:00 Cairo time. Inflation and certificate rates change monthly and are updated
separately, with a source link, when new figures are published.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

DATA = Path(__file__).resolve().parent.parent / "grow" / "data.json"
CAIRO = ZoneInfo("Africa/Cairo")
RATE_URL = "https://open.er-api.com/v6/latest/USD"


def main() -> int:
    now = datetime.now(CAIRO)
    data = json.loads(DATA.read_text())
    forced = os.environ.get("FORCE") == "1"

    # The job is scheduled at 05:00 and 06:00 UTC so one run lands at 8:00 Cairo
    # in both summer and winter time. Skip before 8:00 and if today is already done.
    last = datetime.fromisoformat(data["updated"]).astimezone(CAIRO)
    if not forced and (now.hour < 8 or last.date() == now.date()):
        print(f"Skipping: Cairo time {now:%H:%M}, last update {last:%Y-%m-%d %H:%M}")
        return 0

    with urllib.request.urlopen(RATE_URL, timeout=30) as r:
        payload = json.load(r)
    if payload.get("result") != "success":
        print("Rate source did not return success:", payload.get("result"))
        return 1
    rate = float(payload["rates"]["EGP"])
    # Sanity check so a bad response can never reach the site.
    old = float(data["usd_egp"]["value"])
    if not (10 < rate < 500) or abs(rate - old) / old > 0.25:
        print(f"Rejected suspicious rate {rate} (previous {old})")
        return 1

    as_of = parsedate_to_datetime(payload["time_last_update_utc"]).astimezone(timezone.utc)
    data["usd_egp"]["value"] = round(rate, 2)
    data["usd_egp"]["as_of"] = as_of.strftime("%Y-%m-%d")
    data["updated"] = now.replace(microsecond=0).isoformat()
    DATA.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"Updated dollar rate to {rate:.2f} EGP (as of {data['usd_egp']['as_of']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
