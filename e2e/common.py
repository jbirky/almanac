# Helpers shared by the end-to-end tests.
import sys
from playwright.sync_api import expect

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787/"
BROWSER = sys.argv[2] if len(sys.argv) > 2 else "chromium"
OUT = "/work/shots"
problems = []


def attach(page, name):
    page.on("console", lambda m: m.type in ("error", "warning") and problems.append(f"[{name}] {m.type}: {m.text}"))
    page.on("pageerror", lambda e: problems.append(f"[{name}] pageerror: {e}"))


def wait_synced(page):
    # Give a change just made a moment to show up as pending first.
    page.wait_for_timeout(200)
    expect(page.locator(".sync-status")).to_have_attribute("data-state", "synced", timeout=15000)


def sync_now(page):
    # The sync button sits in the left panel, which is hidden on a phone until opened.
    page.locator(".sync-status button").dispatch_event("click")
    wait_synced(page)


def local_date(page, days=0):
    return page.evaluate(
        "(n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); }", days
    )


seen = [0]


def step(msg):
    print("•", msg, flush=True)
    for line in problems[seen[0]:]:
        print("     ->", line, flush=True)
    seen[0] = len(problems)


def report():
    print("\nconsole problems:" if problems else "\nno console errors or warnings")
    for line in problems:
        print("  ", line)
