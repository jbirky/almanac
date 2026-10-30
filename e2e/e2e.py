# End-to-end test: two browser contexts act as two devices against a running server.
# Run with scripts/e2e (uses the Playwright Docker image).
import base64
import re
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect
from common import BROWSER, OUT, URL, attach, local_date, report, step, sync_now, wait_synced

with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()

    # ---- Laptop -------------------------------------------------------------
    laptop = browser.new_context(viewport={"width": 1200, "height": 820})
    page = laptop.new_page()
    attach(page, "laptop")
    page.goto(URL)
    wait_synced(page)
    if BROWSER == "webkit":
        # Playwright's Linux WebKit has no navigator.storage; the app falls back to memory.
        expect(page.locator(".sync-status .warn")).to_have_count(1)
        step("laptop loaded in memory-only mode (no OPFS in this WebKit build), synced")
    else:
        expect(page.locator(".sync-status .warn")).to_have_count(0)
        step("laptop loaded, persistent storage, synced")

    today = local_date(page)
    tomorrow = local_date(page, 1)
    yesterday = local_date(page, -1)
    overview = page.locator(".overview")
    day_tasks = page.locator(".due-panel")
    box = page.get_by_label("New task")

    box.fill("submit abstract in 5 days #paper")
    preview = overview.locator(".capture-preview")
    expect(preview.locator(".category-chip")).to_have_text("paper · new")
    expect(preview.locator(".date-chip")).to_be_visible()
    box.press("Enter")
    paper = overview.get_by_role("region", name="paper", exact=True)
    expect(paper.locator(".task-row", has_text="submit abstract")).to_be_visible()
    box.fill("read new TESS paper")
    box.press("Enter")
    uncategorized = overview.get_by_role("region", name="No category", exact=True)
    expect(uncategorized.locator("h2")).to_have_text("No category")
    expect(uncategorized.locator(".task-row", has_text="read new TESS paper")).to_be_visible()
    expect(uncategorized.locator(".task-row", has_text="read new TESS paper").locator(".date-chip")).to_have_class(re.compile(r"\bempty\b"))
    step("added tasks: '#paper' makes a new category, previewed as new; one without a category or date goes under No category, undated")

    box.fill("rerun light curve fits today")
    box.press("Enter")
    row = uncategorized.locator(".task-row", has_text="rerun light curve fits")
    expect(row.locator(".date-pick")).to_have_text("Today")
    expect(day_tasks.locator(".task-row", has_text="rerun light curve fits")).to_be_visible()
    row.get_by_label("Mark done").click()
    expect(overview.locator(".task-row", has_text="rerun light curve fits")).to_have_count(0)
    expect(day_tasks.locator(".task-row.done", has_text="rerun light curve fits")).to_be_visible()
    expect(page.locator(".heatmap .cell.today")).to_have_class(re.compile(r"\bl[1-4]\b"))
    step("a task due today shows on today's page; done, it leaves the list and shades today on the calendar")

    page.locator(".prose").click()
    page.keyboard.type("Discussed priors for the fits.")
    page.keyboard.press("Enter")
    page.keyboard.type("[] ")
    expect(page.locator(".task-block-title").first).to_be_focused(timeout=5000)
    page.keyboard.type("Send slides to the group")
    page.keyboard.press("Enter")
    expect(page.locator(".task-block-title")).to_have_count(2)
    expect(page.locator(".task-block-title").nth(1)).to_be_focused(timeout=5000)
    page.keyboard.type("Book telescope time")
    page.wait_for_timeout(1600)
    expect(uncategorized.locator(".task-row", has_text="Send slides to the group")).to_be_visible()
    expect(uncategorized.locator(".task-row", has_text="Book telescope time")).to_be_visible()
    expect(day_tasks.locator(".task-row", has_text="Send slides")).to_have_count(0)
    expect(page.locator(".task-block .date-chip.empty")).to_have_count(2)
    expect(uncategorized.locator(".task-row", has_text="Book telescope time").locator(".date-chip")).to_have_class(re.compile(r"\bempty\b"))
    expect(page.locator(".heatmap .cell.today")).to_have_class(re.compile(r"\bwrote\b"))
    step("[] tasks typed in today's journal start with no due date, so they aren't in the Due panel, and are listed on the left")

    tess = overview.locator(".task-row", has_text="read new TESS paper")
    tess.locator(".date-chip input").fill(tomorrow)
    expect(tess.locator(".date-pick")).to_have_text("Tomorrow")
    expect(page.locator(f'.heatmap .cell[data-date="{tomorrow}"]')).to_have_class(re.compile(r"\bdue\b"))
    tess.get_by_label("Add a category").click()
    page.get_by_label("Category", exact=True).fill("PAPER")
    page.get_by_label("Category", exact=True).press("Enter")
    expect(paper.locator(".task-row")).to_have_text([re.compile("read new TESS paper"), re.compile("submit abstract")])
    abstract = paper.locator(".task-row", has_text="submit abstract")
    expect(abstract.locator(".date-chip")).not_to_have_class(re.compile(r"\bempty\b"))
    abstract.hover()
    abstract.get_by_role("button", name="Remove due date").click()
    expect(abstract.locator(".date-chip")).to_have_class(re.compile(r"\bempty\b"))
    expect(page.locator(".heatmap .cell.due")).to_have_count(1)
    step("a date picked in the chip dots the calendar; × removes one; typing an existing category in any case files the task under it, soonest due first")

    due_today = page.get_by_role("region", name="Due today")
    due_list = due_today.get_by_role("list", name="Due today")
    due_today.get_by_label("Add a task due today").fill("call the observatory #observing")
    due_today.get_by_label("Add a task due today").press("Enter")
    expect(due_list.locator(".task-row")).to_have_text([re.compile("call the observatory"), re.compile("rerun light curve fits")])
    expect(overview.locator(".task-row", has_text="call the observatory").locator(".date-pick")).to_have_text("Today")
    page.locator(".task-block").nth(0).locator(".date-chip input").fill(today)
    expect(due_list.locator(".task-row", has_text="Send slides to the group")).to_be_visible()
    box.fill("tidy the desk")
    box.press("Enter")
    overview.locator(".task-row", has_text="tidy the desk").get_by_label("Mark done").click()
    expect(due_today.get_by_role("list", name="Also finished").locator(".task-row.done", has_text="tidy the desk")).to_be_visible()
    expect(due_today.get_by_role("list", name="Also finished").locator(".task-row", has_text="rerun light curve fits")).to_have_count(0)
    step("the 'Due today' panel lists what's due today, journal tasks too, adds tasks due today, and shows what else was finished")

    page.locator(".task-block").nth(1).get_by_label("Add a category").click()
    page.get_by_label("Category", exact=True).fill("observing")
    page.get_by_label("Category", exact=True).press("Enter")
    expect(page.locator(".task-block").nth(1).locator(".category-chip")).to_have_text("observing")
    expect(overview.get_by_role("region", name="observing", exact=True).locator(".task-row", has_text="Book telescope time")).to_be_visible()
    expect(overview.locator(".task-group h2")).to_have_text(["observing", "paper", "No category"])
    step("a task block in the journal takes a category too; categories are alphabetical with No category last")

    # A category moves by the grip beside its name: dragged, or with the arrow keys on it.
    groups = overview.locator(".task-group h2")
    observing_group = overview.get_by_role("region", name="observing", exact=True)
    paper_head = overview.get_by_role("region", name="paper", exact=True).locator(".task-group-head")
    paper_head.hover()
    start = paper_head.get_by_role("button", name="Move paper").bounding_box()
    above = observing_group.bounding_box()
    page.mouse.move(start["x"] + start["width"] / 2, start["y"] + start["height"] / 2)
    page.mouse.down()
    page.mouse.move(start["x"] + start["width"] / 2, above["y"] + 4, steps=5)
    expect(observing_group).to_have_class(re.compile(r"\bdrop-before\b"))
    page.mouse.up()
    expect(groups).to_have_text(["paper", "observing", "No category"])
    grip = overview.get_by_role("button", name="Move paper")
    grip.focus()
    page.keyboard.press("ArrowDown")
    expect(groups).to_have_text(["observing", "paper", "No category"])
    expect(grip).to_be_focused()
    page.keyboard.press("ArrowUp")
    expect(groups).to_have_text(["paper", "observing", "No category"])
    expect(overview.get_by_role("button", name="Move No category")).to_have_count(0)
    step("a category moves by dragging the grip beside its name, or with the arrow keys on it; No category stays last")

    # A task moves by the grip beside it: dragged within its category or into another, which it
    # then takes, or with the arrow keys on it.
    def drag_task(title, onto, below=False):
        item = overview.locator(".task-item", has_text=title).first
        item.locator(".task-row").first.hover()
        grip = item.get_by_role("button", name=f"Move “{title}”").bounding_box()
        to = onto.bounding_box()
        page.mouse.move(grip["x"] + grip["width"] / 2, grip["y"] + grip["height"] / 2)
        page.mouse.down()
        page.mouse.move(grip["x"] + grip["width"] / 2, to["y"] + to["height"] - 2 if below else to["y"] + 2, steps=6)
        page.mouse.up()

    paper_rows = paper.locator(".task-row")
    observing_rows = observing_group.locator(".task-row")
    expect(paper_rows).to_have_text([re.compile("read new TESS paper"), re.compile("submit abstract")])
    drag_task("submit abstract", paper.locator(".task-item", has_text="read new TESS paper"))
    expect(paper_rows).to_have_text([re.compile("submit abstract"), re.compile("read new TESS paper")])
    grip = paper.get_by_role("button", name="Move “submit abstract”")
    grip.focus()
    page.keyboard.press("ArrowDown")
    expect(paper_rows).to_have_text([re.compile("read new TESS paper"), re.compile("submit abstract")])
    expect(grip).to_be_focused()
    page.keyboard.press("ArrowUp")
    expect(paper_rows).to_have_text([re.compile("submit abstract"), re.compile("read new TESS paper")])
    drag_task("Book telescope time", paper.locator(".task-item", has_text="read new TESS paper"))
    expect(paper_rows).to_have_text([re.compile("submit abstract"), re.compile("Book telescope time"), re.compile("read new TESS paper")])
    expect(observing_rows).to_have_text([re.compile("call the observatory")])
    expect(page.locator(".task-block").nth(1).locator(".task-block-title")).to_have_value("Book telescope time")
    expect(page.locator(".task-block").nth(1).locator(".category-chip")).to_have_text("paper")
    drag_task("Book telescope time", observing_group.locator(".task-item", has_text="call the observatory"), below=True)
    expect(observing_rows).to_have_text([re.compile("call the observatory"), re.compile("Book telescope time")])
    expect(paper_rows).to_have_text([re.compile("submit abstract"), re.compile("read new TESS paper")])
    step("a task moves by dragging the grip beside it, within its category or into another, or with the arrow keys on it")
    page.screenshot(path=f"{OUT}/{BROWSER}-1-today.png")

    titles = page.locator(".task-block-title")
    # Dropped at the end of a line, a block goes after it (the drop cursor shows where).
    priors = page.locator(".prose > p", has_text="Discussed priors")
    line = priors.bounding_box()
    page.locator(".task-block").nth(1).hover()
    page.locator(".task-block").nth(1).locator(".drag-handle").drag_to(
        priors, target_position={"x": line["width"] - 10, "y": line["height"] / 2}
    )
    expect(titles.nth(0)).to_have_value("Book telescope time")
    expect(titles.nth(1)).to_have_value("Send slides to the group")
    titles.nth(0).focus()
    page.keyboard.press("Alt+ArrowDown")
    expect(titles.nth(0)).to_have_value("Send slides to the group")
    expect(titles.nth(1)).to_have_value("Book telescope time")
    expect(titles.nth(1)).to_be_focused()
    page.locator(".prose > p", has_text="Discussed priors").click()
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    page.keyboard.type("[] ")
    expect(titles.nth(0)).to_be_focused(timeout=5000)
    page.keyboard.type("Scratch task")
    expect(overview.locator(".task-row", has_text="Scratch task")).to_be_visible(timeout=5000)
    page.locator(".task-block").nth(0).hover()
    page.locator(".task-block").nth(0).get_by_role("button", name="Delete task").click()
    expect(titles).to_have_count(2)
    expect(titles.nth(0)).to_have_value("Send slides to the group")
    expect(overview.locator(".task-row", has_text="Scratch task")).to_have_count(0)
    step("a task block moves by dragging its grip or with Alt+arrow keys; its delete button deletes the task")

    # A click in a task's title puts the cursor there, in the list and in the journal.
    abstract_title = paper.locator(".task-row", has_text="submit abstract").locator(".task-title")
    at = abstract_title.evaluate(
        """el => { const r = document.createRange(); r.setStart(el.firstChild, 7); r.setEnd(el.firstChild, 8);
                   const b = r.getBoundingClientRect(); return { x: b.left + 1, y: b.top + b.height / 2 }; }"""
    )
    page.mouse.click(at["x"], at["y"])
    page.keyboard.type("the ")
    expect(paper.locator(".task-title-input")).to_have_value("submit the abstract")
    page.keyboard.press("Escape")
    expect(paper.locator(".task-row", has_text="submit abstract")).to_be_visible()
    book_title = page.locator(".task-block-title").nth(1)
    edge = book_title.bounding_box()
    page.mouse.click(edge["x"] + 2, edge["y"] + edge["height"] / 2)
    page.keyboard.type("Re-")
    expect(book_title).to_have_value("Re-Book telescope time")
    for _ in range(3):
        page.keyboard.press("Backspace")
    expect(book_title).to_have_value("Book telescope time")
    step("a click in a task's title puts the cursor there, in the list and in the journal")

    tess_item = paper.locator(".task-item", has_text="read new TESS paper")
    tess_item.hover()
    tess_item.get_by_role("button", name="Add a subtask").click()
    expect(tess_item.get_by_label("New subtask")).to_be_focused()
    page.keyboard.type("skim the abstract")
    page.keyboard.press("Enter")
    page.keyboard.type("check the systematics")
    page.keyboard.press("Enter")
    expect(tess_item.locator(".subtask-title")).to_have_count(2)
    tess_item.locator(".subtask").nth(0).get_by_label("Mark subtask done").click()
    expect(tess_item.get_by_role("button", name="Subtasks, 1 of 2 done")).to_have_text("1/2")
    expect(overview.locator(".task-row", has_text="skim the abstract")).to_have_count(0)
    book = page.locator(".task-block-item").nth(1)
    book.hover()
    book.get_by_role("button", name="Add a subtask").click()
    book.get_by_label("New subtask").fill("pick the nights")
    book.get_by_label("New subtask").press("Enter")
    expect(book.locator(".subtask-title")).to_have_value("pick the nights")
    expect(overview.locator(".task-item", has_text="Book telescope time").locator(".subtask-chip")).to_have_text("0/1")
    step("a task takes subtasks, from the list or the journal, listed under it with a count, not on their own")

    # ---- Notes boxes --------------------------------------------------------
    boxes = page.locator(".note-box")
    page.locator(".journal-rest").click()
    expect(page.locator(".prose")).to_be_focused()
    page.keyboard.type("#meeting ")
    expect(boxes).to_have_count(1)
    expect(boxes.first.locator(".label-chip")).to_have_text("meeting")
    expect(boxes.first).to_have_attribute("data-color", "blue")
    page.keyboard.type("Group meeting with the TESS team")
    page.keyboard.press("Enter")
    page.keyboard.type("Agreed to rerun the fits.")
    page.keyboard.press("Enter")
    page.keyboard.type("[] ")
    expect(boxes.first.locator(".task-block-title")).to_be_focused(timeout=5000)
    page.keyboard.type("Email the priors to the group")
    page.keyboard.press("ArrowDown")
    expect(page.locator(".prose")).to_be_focused()
    page.keyboard.type("After the meeting.")
    expect(boxes.first).not_to_contain_text("After the meeting.")
    expect(page.locator(".prose > p", has_text="After the meeting.")).to_have_count(1)
    expect(overview.get_by_role("region", name="meeting", exact=True).locator(".task-row", has_text="Email the priors to the group")).to_be_visible(timeout=5000)
    step("'#meeting ' starts a box under a new label in the first color; a [] task inside it is listed on the left under the box's label; arrow down leaves it")

    page.get_by_role("button", name="+ Notes box").click()
    expect(page.get_by_label("Find or create a label")).to_be_focused()
    expect(page.locator(".label-options li")).to_have_text([re.compile("meeting")])
    page.keyboard.type("Paper notes")
    expect(page.locator(".label-options li.active")).to_have_text("Create “Paper notes”")
    page.screenshot(path=f"{OUT}/{BROWSER}-8-label-picker.png")
    page.keyboard.press("Enter")
    expect(boxes).to_have_count(2)
    expect(boxes.nth(1).locator(".label-chip")).to_have_text("Paper notes")
    expect(boxes.nth(1)).to_have_attribute("data-color", "orange")
    expect(page.locator(".prose")).to_be_focused()
    page.keyboard.type("Smith et al. 2024: TESS systematics")
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    page.keyboard.type("Below the boxes.")
    expect(boxes.nth(1)).not_to_contain_text("Below the boxes.")
    step("'+ Notes box' adds a box and opens its label picker; Enter on an empty last line leaves the box")

    boxes.nth(1).locator(".label-chip").click()
    page.get_by_role("button", name=re.compile("Rename or recolor")).click()
    page.get_by_role("radio", name="Purple").click()
    expect(boxes.nth(1)).to_have_attribute("data-color", "purple")
    page.screenshot(path=f"{OUT}/{BROWSER}-9-label-editor.png")
    page.get_by_label("Label name").fill("meeting")
    expect(page.locator(".label-error")).to_have_text("Another label has that name.")
    page.get_by_label("Label name").fill("Paper reading")
    page.get_by_label("Label name").press("Enter")
    page.get_by_label("Find or create a label").press("Escape")
    expect(page.locator(".label-picker")).to_have_count(0)
    expect(boxes.nth(1).locator(".label-chip")).to_have_text("Paper reading")
    step("a label's name and color change from its box; a name another label has is refused")

    # Dropped at the start of a box's first line, a box goes before that box; at the end of a
    # line, after it.
    boxes.nth(1).hover()
    boxes.nth(1).locator(".box-grip").drag_to(boxes.first.locator(".note-box-body p").first, target_position={"x": 2, "y": 4})
    expect(page.locator(".note-box .label-chip")).to_have_text(["Paper reading", "meeting"])
    expect(boxes.first).to_contain_text("Smith et al. 2024: TESS systematics")
    after = page.locator(".prose > p", has_text="After the meeting.")
    line = after.bounding_box()
    boxes.first.hover()
    boxes.first.locator(".box-grip").drag_to(after, target_position={"x": line["width"] - 10, "y": line["height"] / 2})
    expect(page.locator(".note-box .label-chip")).to_have_text(["meeting", "Paper reading"])
    expect(boxes.nth(1)).to_contain_text("Smith et al. 2024: TESS systematics")
    assert after.bounding_box()["y"] < boxes.nth(1).bounding_box()["y"], "the box went back below 'After the meeting.'"
    # A box dragged while it's selected, with the selection moving on the way (as some browsers
    # do), still moves rather than leaving a copy: it used to drop a copy of itself.
    page.evaluate("""() => {
      const editor = document.querySelector('.prose').editor;
      let at = null;
      editor.state.doc.forEach((node, offset) => { if (at === null && node.type.name === 'noteBox') at = offset; });
      editor.commands.setNodeSelection(at);
    }""")
    boxes.first.hover()
    grip = boxes.first.locator(".box-grip").bounding_box()
    end = page.locator(".prose > p", has_text="Below the boxes.").bounding_box()
    page.mouse.move(grip["x"] + grip["width"] / 2, grip["y"] + grip["height"] / 2)
    page.mouse.down()
    page.mouse.move(grip["x"] + 10, grip["y"] + 10, steps=3)
    page.evaluate("() => document.querySelector('.prose').editor.commands.setTextSelection(1)")
    page.mouse.move(end["x"] + end["width"] - 5, end["y"] + end["height"] / 2, steps=8)
    page.mouse.up()
    expect(page.locator(".note-box .label-chip")).to_have_text(["Paper reading", "meeting"])
    boxes.nth(1).hover()
    boxes.nth(1).locator(".box-grip").drag_to(after, target_position={"x": 2, "y": 4})
    expect(page.locator(".note-box .label-chip")).to_have_text(["meeting", "Paper reading"])
    assert boxes.first.bounding_box()["y"] < after.bounding_box()["y"] < boxes.nth(1).bounding_box()["y"], "the boxes are back in place"
    step("a notes box moves, notes and all, by dragging the grip beside its label, even if the selection moves on the way")

    # A box pinned from its label shows on the days after its own: the box itself, so writing in
    # it there writes in it on its day. Unpinned there, it's gone from that day on.
    boxes.first.locator(".label-chip").click()
    page.get_by_role("button", name="Pin to the days after this one").click()
    expect(boxes.first.get_by_role("img", name="Pinned to the days after this one")).to_be_visible()
    page.get_by_label("Next day").click()
    expect(page.locator(".kicker")).to_have_text("Tomorrow")
    pinned = page.locator(".pinned-boxes .note-box")
    expect(pinned).to_have_count(1)
    expect(pinned.locator(".label-chip")).to_have_text("meeting")
    expect(pinned.locator(".pinned-from")).to_contain_text(re.compile(r"\w"))
    expect(pinned.locator(".task-block-title")).to_have_value("Email the priors to the group")
    pinned.locator(".prose p", has_text="Group meeting with the TESS team").click()
    page.keyboard.press("End")
    page.keyboard.type(" (weekly)")
    page.wait_for_timeout(1200)
    page.get_by_label("Previous day").click()
    expect(page.locator(".kicker")).to_have_text("Today")
    expect(boxes.first).to_contain_text("Group meeting with the TESS team (weekly)")
    page.get_by_label("Next day").click()
    page.locator(".pinned-boxes").get_by_role("button", name="Unpin").click()
    expect(page.locator(".pinned-boxes .note-box")).to_have_count(0)
    page.get_by_label("Previous day").click()
    expect(boxes.first.get_by_role("img", name="Pinned to the days after this one")).to_have_count(0)
    step("a box pinned from its label shows on the days after, the same box, written in there too; unpinned there, it's gone from that day on")

    boxes.first.locator(".label-chip").click()
    page.get_by_role("button", name="Rename or recolor “meeting”").click()
    page.get_by_label("Any color").fill("#e0a800")
    expect(boxes.first).to_have_attribute("data-color", "custom")
    expect(page.locator(".label-note")).to_contain_text("darker shade")
    # Gold on a light background is too pale to read, so labels show it darker.
    expect(boxes.first.locator(".label-chip")).to_have_css("color", "rgb(134, 81, 0)")
    expect(page.get_by_role("radio", checked=True)).to_have_count(0)
    page.screenshot(path=f"{OUT}/{BROWSER}-12-any-color.png")
    page.get_by_role("button", name="‹ Labels").click()
    page.get_by_label("Find or create a label").press("Escape")
    expect(page.locator(".label-picker")).to_have_count(0)
    step("a label can take any color from the picker; one too light to read shows darker")

    page.get_by_role("button", name="+ Notes box").click()
    page.get_by_label("Find or create a label").press("Escape")
    expect(boxes).to_have_count(3)
    expect(boxes.nth(2).locator(".label-chip")).to_have_text("Add label")
    expect(page.locator(".prose")).to_be_focused()
    page.keyboard.press("Backspace")
    expect(boxes).to_have_count(2)
    step("Escape leaves a box unlabeled; Backspace in an empty box removes it")

    page.locator(".task-block-title").nth(1).focus()  # Book telescope time, just above the meeting box
    page.keyboard.press("Alt+ArrowDown")
    expect(boxes.first.locator(".task-block-title").first).to_have_value("Book telescope time")
    expect(boxes.first.locator(".task-block-title").first).to_be_focused()
    page.keyboard.press("Alt+ArrowUp")
    expect(boxes.first.locator(".task-block-title")).to_have_count(1)
    expect(page.locator(".task-block-title").nth(1)).to_have_value("Book telescope time")
    expect(page.locator(".task-block-title").nth(1)).to_be_focused()
    step("Alt+arrow keys move a task into the notes box next to it and back out")
    page.wait_for_timeout(1200)
    page.screenshot(path=f"{OUT}/{BROWSER}-5-notes-boxes.png", full_page=True)
    page.emulate_media(color_scheme="dark")
    page.screenshot(path=f"{OUT}/{BROWSER}-6-notes-boxes-dark.png", full_page=True)
    page.emulate_media(color_scheme="light")

    page.locator(f'.heatmap .cell[data-date="{tomorrow}"]').click()
    expect(page).to_have_url(re.compile(f"#/{tomorrow}$"))
    expect(page.locator(".kicker")).to_have_text("Tomorrow")
    expect(day_tasks.locator(".task-row", has_text="read new TESS paper").locator(".category-chip")).to_have_text("paper")
    page.locator(".prose").click()
    page.keyboard.type("Plan for tomorrow.")
    page.keyboard.press("Enter")
    page.keyboard.type("#MEETING ")
    expect(page.locator(".note-box .label-chip")).to_have_text("meeting")
    page.keyboard.type("Advisor check-in")
    page.wait_for_timeout(1200)

    page.locator(f'.heatmap .cell[data-date="{yesterday}"]').click()
    page.locator(".journal-rest").click()
    expect(page.locator(".prose")).to_be_focused()
    page.keyboard.type("Reading day.")
    page.keyboard.press("Enter")
    page.keyboard.type("#lecture Intro to exoplanets")
    page.wait_for_timeout(1200)
    step("'#MEETING ' reuses the meeting label")

    # ---- The journal by label -----------------------------------------------
    views = page.get_by_role("navigation", name="Views")
    tabs = page.get_by_role("navigation", name="Labels")
    sections = page.locator(".label-day")
    views.get_by_role("link", name="By label").click()
    expect(views.get_by_role("link", name="By label")).to_have_attribute("aria-current", "page")
    expect(page.locator(".label-title")).to_have_text("meeting")  # the label used most recently
    expect(tabs.get_by_role("link")).to_have_text(["lecture", "meeting", "Paper reading"])
    expect(sections.locator("h2")).to_have_text([re.compile("^Tomorrow"), re.compile("^Today")])
    expect(sections.nth(1)).to_contain_text("Group meeting with the TESS team")
    expect(sections.nth(1).locator(".task-block-title")).to_have_value("Email the priors to the group")
    expect(sections.nth(1)).not_to_contain_text("After the meeting.")
    expect(page.locator(".heatmap .cell.match")).to_have_count(2)
    sections.nth(0).locator(".prose p", has_text="Advisor check-in").click()
    page.keyboard.press("End")
    page.keyboard.type(": bring the draft")
    page.keyboard.press("Enter")
    page.keyboard.type("[] ")
    expect(sections.nth(0).locator(".task-block-title")).to_be_focused(timeout=5000)
    page.keyboard.type("Print the draft")
    expect(overview.get_by_role("region", name="meeting", exact=True).locator(".task-row", has_text="Print the draft")).to_be_visible(timeout=5000)
    page.wait_for_timeout(1200)
    page.screenshot(path=f"{OUT}/{BROWSER}-7-by-label.png")
    sections.nth(0).locator("h2 button").click()
    expect(page.locator(".kicker")).to_have_text("Tomorrow")
    expect(page.locator(".note-box")).to_contain_text("Advisor check-in: bring the draft")
    expect(page.locator(".note-box .task-block-title")).to_have_value("Print the draft")
    step("'By label' shows the label used last, one section per day, newest first; a box edited there is the day's own")

    views.get_by_role("link", name="By label").click()
    tabs.get_by_role("link", name="lecture").click()
    expect(page.locator(".label-title")).to_have_text("lecture")
    expect(sections.locator("h2")).to_have_text([re.compile("^Today"), re.compile("^Yesterday")])
    expect(page.locator(".heatmap .cell.match")).to_have_count(1)
    page.get_by_role("button", name="Edit label").click()
    page.get_by_role("radio", name="Green").click()
    expect(page.locator(".label-page")).to_have_attribute("data-color", "green")
    expect(tabs.get_by_role("link", name="lecture")).to_have_attribute("data-color", "green")
    page.get_by_role("button", name="Done", exact=True).click()
    expect(page.get_by_role("dialog")).to_have_count(0)
    page.get_by_role("button", name="+ Add to today").click()
    expect(sections.nth(0).locator(".prose")).to_be_focused()
    page.keyboard.type("Transit photometry")
    page.wait_for_timeout(1200)
    expect(page.locator(".heatmap .cell.match")).to_have_count(2)
    page.emulate_media(color_scheme="dark")
    page.screenshot(path=f"{OUT}/{BROWSER}-10-by-label-dark.png")
    page.emulate_media(color_scheme="light")
    views.get_by_role("link", name="By day").click()
    expect(page.locator(".kicker")).to_have_text("Tomorrow")
    page.get_by_role("button", name="Today", exact=True).click()
    expect(boxes).to_have_count(3)
    expect(boxes.nth(2).locator(".label-chip")).to_have_text("lecture")
    expect(boxes.nth(2)).to_contain_text("Transit photometry")
    boxes.nth(2).locator(".label-chip").click()
    page.get_by_role("button", name="All “lecture” notes, by day").click()
    expect(page.locator(".label-title")).to_have_text("lecture")
    sections.nth(0).locator(".prose").click()
    page.keyboard.press("ControlOrMeta+a")
    page.keyboard.press("Backspace")
    page.keyboard.press("Backspace")
    expect(page.get_by_role("button", name="+ Add to today")).to_be_visible()
    expect(page.locator(".label-day .note-box")).to_have_count(1)
    page.wait_for_timeout(1200)
    views.get_by_role("link", name="By day").click()
    expect(boxes).to_have_count(2)
    step("'Edit label' recolors a label from its page; '+ Add to today' starts a box in today's journal; a box's picker opens its label; Backspace in an empty box removes it")

    page.locator(f'.heatmap .cell[data-date="{tomorrow}"]').focus()
    page.keyboard.press("ArrowUp")
    expect(page.locator(".kicker")).to_have_text("Today")
    expect(page.locator(f'.heatmap .cell[data-date="{today}"]')).to_be_focused()
    expect(page.locator(".prose")).to_contain_text("Discussed priors")
    step("the calendar opens a future day with what's due; arrow keys step between days")

    search = page.get_by_label("Search")
    search.fill("priors")
    expect(page.locator(".search-results li")).to_have_count(1)
    expect(page.locator(".search-results mark")).to_have_text("priors")
    expect(page.locator(".heatmap .cell.match")).to_have_count(1)
    expect(page.locator(".heatmap .cell.dim").first).to_be_visible()
    search.fill("tomorrow")
    page.locator(".search-results button").first.click()
    expect(page.locator(".kicker")).to_have_text("Tomorrow")
    page.screenshot(path=f"{OUT}/{BROWSER}-2-search.png")
    search.press("Escape")
    expect(page.locator(".search-results")).to_have_count(0)
    expect(page.locator(".heatmap .cell.dim")).to_have_count(0)
    page.get_by_role("button", name="Today", exact=True).click()
    expect(page.locator(".kicker")).to_have_text("Today")
    step("search lists matching days, highlights them on the calendar, and opens one")

    page.locator(".prose").click()
    page.keyboard.press("Control+k")
    expect(box).to_be_focused()
    page.evaluate("document.activeElement.blur()")
    page.keyboard.press("/")
    expect(search).to_be_focused()
    search.press("Escape")
    step("Ctrl+K jumps to the task field and / to search")

    wait_synced(page)
    step("laptop changes pushed")

    # ---- Phone (separate storage = a second device) ------------------------
    phone_ctx = browser.new_context(viewport={"width": 390, "height": 844})
    phone = phone_ctx.new_page()
    attach(phone, "phone")
    phone.goto(URL)
    wait_synced(phone)
    expect(phone.locator(".prose")).to_contain_text("Discussed priors")
    expect(phone.locator(".task-block-title").first).to_have_value("Send slides to the group")
    expect(phone.locator(".overview")).not_to_be_visible()
    expect(phone.locator(".note-box .label-chip")).to_have_text(["meeting", "Paper reading"])
    expect(phone.locator(".note-box").nth(1)).to_have_attribute("data-color", "purple")
    expect(phone.locator(".note-box").first.locator(".label-chip")).to_have_css("color", "rgb(134, 81, 0)")
    phone.screenshot(path=f"{OUT}/{BROWSER}-3-phone-day.png")
    phone.locator(".day-title").click()
    expect(phone.locator(".overview")).to_be_visible()
    expect(phone.locator(".overview .task-row", has_text="submit abstract")).to_be_visible()
    expect(phone.locator(".overview .task-item", has_text="read new TESS paper").locator(".subtask-chip")).to_have_text("1/2")
    expect(phone.locator(".overview .task-group h2").nth(0)).to_have_text("paper")  # the order set on the laptop
    expect(phone.locator(".overview .task-group h2").nth(1)).to_have_text("observing")
    expect(phone.locator('.overview .task-group[data-group="paper"] .task-row').first).to_contain_text("submit abstract")
    phone.wait_for_timeout(300)  # let the panel finish sliding in
    phone.screenshot(path=f"{OUT}/{BROWSER}-4-phone-calendar.png")
    phone.locator(f'.heatmap .cell[data-date="{tomorrow}"]').click()
    expect(phone.locator(".overview")).not_to_be_visible()
    expect(phone.locator(".prose")).to_contain_text("Plan for tomorrow.")
    phone.get_by_label("Previous day").click()
    expect(phone.locator(".kicker")).to_have_text("Today")
    step("phone pulled the journal and tasks; the calendar slides over the day and closes on a pick")

    phone.get_by_role("link", name="By label").click()
    expect(phone.locator(".label-title")).to_have_text("meeting")
    expect(phone.locator(".label-day").first).to_contain_text("Advisor check-in: bring the draft")
    phone.screenshot(path=f"{OUT}/{BROWSER}-11-phone-by-label.png")
    phone.get_by_role("link", name="By day").click()
    expect(phone.locator(".kicker")).to_have_text("Today")
    step("phone shows the journal by label too")

    # Live update: phone checks off a task block; laptop's open journal reflects it.
    expect(page.locator(".task-block").first).not_to_have_class(re.compile(r"\bdone\b"))
    phone.locator(".task-block .check").first.click()
    expect(phone.locator(".task-block").first).to_have_class(re.compile(r"\bdone\b"))
    wait_synced(phone)
    sync_now(page)
    expect(page.locator(".task-block").first).to_have_class(re.compile(r"\bdone\b"), timeout=5000)
    step("checking a task block on the phone updates the laptop's open journal")

    # Offline edits to the same paragraph on both devices merge.
    laptop.set_offline(True)
    phone_ctx.set_offline(True)
    page.locator(".prose p", has_text="Discussed priors").click()
    page.keyboard.press("End")
    page.keyboard.type(" Laptop was offline.")
    phone.locator(".prose p", has_text="Discussed priors").click()
    phone.keyboard.press("Home")
    phone.keyboard.type("Phone was offline. ")
    page.wait_for_timeout(1600)
    phone.wait_for_timeout(1600)
    expect(page.locator(".sync-status")).to_have_attribute("data-state", "offline", timeout=40000)
    expect(page.locator(".sync-status")).to_contain_text("waiting")
    laptop.set_offline(False)
    phone_ctx.set_offline(False)
    sync_now(page)
    sync_now(phone)
    sync_now(page)
    for name, pg in (("laptop", page), ("phone", phone)):
        expect(pg.locator(".prose")).to_contain_text("Laptop was offline.", timeout=5000)
        expect(pg.locator(".prose")).to_contain_text("Phone was offline.", timeout=5000)
    step("offline edits to the same paragraph on both devices merged")

    # The border between the panels drags to resize them; the width stays in this browser.
    splitter = page.get_by_role("separator", name="Resize the left panel")
    edge = splitter.bounding_box()
    page.mouse.move(edge["x"] + edge["width"] / 2, edge["y"] + 300)
    page.mouse.down()
    page.mouse.move(edge["x"] + edge["width"] / 2 + 100, edge["y"] + 300, steps=5)
    page.mouse.up()
    expect(splitter).to_have_attribute("aria-valuenow", "520")
    assert round(overview.bounding_box()["width"]) == 520

    # Reload: data comes back from the device's own storage.
    page.reload()
    if BROWSER == "webkit":
        wait_synced(page)
    expect(page.locator(".overview .task-row", has_text="Book telescope time")).to_be_visible()
    expect(page.locator(".prose")).to_contain_text("Phone was offline.")
    expect(page.locator(".overview .task-group h2").first).to_have_text("paper")
    step("data survives a reload")

    expect(splitter).to_have_attribute("aria-valuenow", "520")
    assert round(overview.bounding_box()["width"]) == 520
    splitter.focus()
    page.keyboard.press("ArrowLeft")
    expect(splitter).to_have_attribute("aria-valuenow", "504")
    splitter.dblclick()
    expect(splitter).to_have_attribute("aria-valuenow", "420")
    step("dragging the border between the panels resizes them, and the width survives a reload; arrow keys and a double-click work too")

    # Settings: light or dark, a color scheme and a font, kept in this browser only.
    choose = lambda name: page.locator("label", has=page.get_by_role("radio", name=name, exact=True)).click()
    html = page.locator("html")
    views.get_by_role("link", name="Settings").click()
    expect(page.get_by_role("heading", name="Settings", level=1)).to_be_visible()
    expect(page.get_by_role("radio", name="Match system")).to_be_checked()
    choose("Dark")
    choose("Ocean")
    choose("EB Garamond")
    expect(html).to_have_attribute("data-theme", "ocean")
    assert page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(19, 22, 26)"
    assert "EB Garamond" in page.evaluate("getComputedStyle(document.body).fontFamily")
    assert page.evaluate("getComputedStyle(document.body).fontSizeAdjust") == "0.47"
    # Every font's card shows that font, which the app has.
    missing = page.evaluate("""async () => {
      const missing = [];
      for (const card of document.querySelectorAll('.font-option:not([data-font=system])')) {
        const family = getComputedStyle(card).fontFamily.split(',')[0];
        if (!(await document.fonts.load(`16px ${family}`)).length) missing.push(card.dataset.font);
      }
      return missing;
    }""")
    assert missing == [], f"fonts not loading: {missing}"
    page.screenshot(path=f"{OUT}/{BROWSER}-13-settings.png", full_page=True)
    page.reload()
    expect(page.get_by_role("radio", name="Ocean", exact=True)).to_be_checked()
    expect(html).to_have_attribute("data-mode", "dark")
    expect(html).to_have_attribute("data-font", "garamond")
    expect(phone.locator("html")).not_to_have_attribute("data-theme", "ocean")
    choose("Match system")
    choose("Paper")
    choose("System")
    assert page.evaluate("Object.keys(document.documentElement.dataset)") == []
    views.get_by_role("link", name="By day").click()
    expect(page.locator(".kicker")).to_have_text("Today")
    step("Settings switch light or dark, the color scheme and the font at once (each of the 13 fonts loads), keep them through a reload, in this browser only")

    # Equations: $...$ in a line, $$...$$ on a line of its own.
    page.locator(f'.heatmap .cell[data-date="{local_date(page, -2)}"]').click()
    page.locator(".journal-rest").click()
    expect(page.locator(".prose")).to_be_focused()
    page.keyboard.type("Lunch was $5 and coffee $3. The fit gave $\\chi^2 = 1.2$ overall.")
    expect(page.locator(".math-inline .katex")).to_have_count(1)
    expect(page.locator(".prose p").first).to_contain_text("Lunch was $5 and coffee $3.")
    page.keyboard.press("Enter")
    page.keyboard.type("$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$")
    expect(page.locator(".math-block .katex-display")).to_have_count(1)
    expect(page.locator(".prose")).to_be_focused()
    page.keyboard.type("Then the error bars.")
    page.locator(".math-inline .math-render").click()
    formula = page.get_by_label("Formula in LaTeX")
    expect(formula).to_have_value("\\chi^2 = 1.2")
    formula.fill("\\chi^2_\\nu = 1.2")
    page.screenshot(path=f"{OUT}/{BROWSER}-14-equations.png")
    formula.press("Enter")
    expect(formula).to_have_count(0)
    expect(page.locator(".math-inline .katex-mathml annotation")).to_have_text("\\chi^2_\\nu = 1.2")
    page.wait_for_timeout(1200)
    search.fill("chi")
    expect(page.locator(".search-results li")).to_have_count(1)
    search.press("Escape")
    page.get_by_role("button", name="Today", exact=True).click()
    step("$...$ and $$...$$ render as equations (prices stay text); a click edits one; their LaTeX is searchable")

    # Images: dropped on a note or pasted into it, made smaller when large, synced.
    add_file = """async ({ how, name, type, width, height, x, y, count = 1 }) => {
      let blob = new Blob(['not a picture'], { type });
      if (type === 'image/png') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        // A gradient with grain: large as a PNG, like a photo.
        const pixels = context.createImageData(width, height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const v = ((i / 4) % width) / width * 200 + Math.random() * 40;
          pixels.data.set([v, 120, 255 - v, 255], i);
        }
        context.putImageData(pixels, 0, 0);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      }
      const data = new DataTransfer();
      for (let i = 0; i < count; i++) data.items.add(new File([blob], name, { type }));
      const prose = document.querySelector('.day-page .prose');
      const init = { bubbles: true, cancelable: true };
      if (how === 'drop') {
        prose.dispatchEvent(new DragEvent('drop', { ...init, dataTransfer: data, clientX: x, clientY: y }));
      } else {
        // Firefox leaves files out of a paste event made by a script, so it's handed over as is.
        const paste = new ClipboardEvent('paste', init);
        Object.defineProperty(paste, 'clipboardData', { value: data });
        prose.dispatchEvent(paste);
      }
      return blob.size;
    }"""
    image_day = local_date(page, -3)
    page.locator(f'.heatmap .cell[data-date="{image_day}"]').click()
    expect(page).to_have_url(re.compile(image_day))
    expect(page.locator(".prose")).to_have_text("")
    page.locator(".journal-rest").click()
    expect(page.locator(".prose")).to_be_focused()
    page.keyboard.type("The light curve:")
    line = page.locator(".prose > p", has_text="The light curve").bounding_box()
    page.evaluate(add_file, {"how": "drop", "name": "light curve.png", "type": "image/png", "width": 320, "height": 200,
                             "x": line["x"] + line["width"] - 10, "y": line["y"] + line["height"] / 2})
    images = page.locator(".prose .image-block img")
    expect(images).to_have_count(1)
    expect(images.first).to_have_attribute("alt", "light curve")
    expect(page.locator(".prose > *").nth(1)).to_have_class(re.compile(r"\bnode-image\b"))
    page.wait_for_function("document.querySelector('.image-block img').naturalWidth === 320")
    page.locator(".journal-rest").click()
    expect(page.locator(".prose")).to_be_focused()
    page.keyboard.type("Residuals:")
    size = page.evaluate(add_file, {"how": "paste", "name": "image.png", "type": "image/png", "width": 3200, "height": 2000})
    assert size > 1.5 * 1024 * 1024, size
    expect(images).to_have_count(2, timeout=10000)
    page.wait_for_function("document.querySelectorAll('.image-block img')[1]?.naturalWidth === 2400")
    assert page.evaluate("fetch(document.querySelectorAll('.image-block img')[1].src).then((r) => r.blob()).then((b) => b.type)") == "image/webp"
    expect(page.locator(".prose > *").nth(3)).to_have_class(re.compile(r"\bnode-image\b"))
    # The cursor goes on below a pasted image, so typing doesn't replace it.
    page.keyboard.type("Flat after the fix.")
    expect(page.locator(".prose > *").nth(4)).to_have_text("Flat after the fix.")
    page.keyboard.press("Enter")
    page.evaluate(add_file, {"how": "paste", "name": "image.png", "type": "image/png", "width": 120, "height": 80, "count": 2})
    expect(images).to_have_count(4)
    # Dragged to the end of a line, an image moves to after it.
    first = page.locator(".prose .node-image").first
    first.scroll_into_view_if_needed()
    flat = page.locator(".prose > p", has_text="Flat after the fix.")
    box_ = flat.bounding_box()
    first.drag_to(flat, target_position={"x": box_["width"] - 10, "y": box_["height"] / 2})
    expect(page.locator(".prose > *").nth(1)).to_have_text("Residuals:")
    expect(page.locator(".prose > *").nth(4).locator("img")).to_have_attribute("alt", "light curve")
    expect(images).to_have_count(4)
    page.evaluate(add_file, {"how": "drop", "name": "notes.txt", "type": "text/plain", "x": line["x"] + 10, "y": line["y"] + 5})
    expect(page.locator(".notice")).to_have_text(re.compile("Only images can go in notes"))
    expect(images).to_have_count(4)
    page.screenshot(path=f"{OUT}/{BROWSER}-15-images.png")
    page.wait_for_timeout(1200)
    sync_now(page)
    sync_now(phone)
    phone.goto(f"{URL}#/{image_day}")
    expect(phone.locator(".prose .image-block img")).to_have_count(4, timeout=10000)
    phone.wait_for_function("[...document.querySelectorAll('.image-block img')].every((img) => img.naturalWidth > 0)")
    phone.screenshot(path=f"{OUT}/{BROWSER}-16-phone-images.png")
    # Clicking an image selects it; Backspace removes it.
    images.first.click()
    expect(page.locator(".image-block.selected")).to_have_count(1)
    page.keyboard.press("Backspace")
    expect(images).to_have_count(3)
    page.wait_for_timeout(1200)
    sync_now(page)
    sync_now(phone)
    expect(phone.locator(".prose .image-block img")).to_have_count(3)
    phone.goto(URL)
    page.get_by_role("button", name="Today", exact=True).click()
    step("an image dropped on the journal goes where it's dropped; a large pasted one is made smaller, with the cursor below it; two paste at once; dragging moves one; other files are refused; they reach the phone; Backspace removes one")

    # Images from the web: a pasted link to a GIF, or a picture copied from a page, is fetched by
    # the server (answered here by the test) and kept whole, so it still moves.
    gif = base64.b64decode("R0lGODlhKAAeAIAAAExpccg8PCH/C05FVFNDQVBFMi4wAwEAAAAh+QQFHgAAACwAAAAAKAAeAAACIYyPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kxzBQAh+QQFHgAAACwAAAAAKAAeAIBMaXE8PMgCIYyPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kxzBQA7")
    fetched = []
    def answer_image(route):
        url = parse_qs(urlparse(route.request.url).query)["url"][0]
        fetched.append(url)
        if url.endswith("missing.gif"):
            route.fulfill(status=422, json={"error": "There's no image at example.org/missing.gif."})
        else:
            route.fulfill(status=200, body=gif, headers={"Content-Type": "image/gif", "X-Image-Name": "cat-dance.gif"})
    page.route(re.compile(r"/api/image\?"), answer_image)
    paste = """async ({ types, png = false }) => {
      const data = new DataTransfer();
      for (const [type, value] of Object.entries(types)) data.setData(type, value);
      if (png) {
        // What a browser's "Copy image" puts on the clipboard with the picture's address: a PNG.
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 8;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        data.items.add(new File([blob], 'image.png', { type: 'image/png' }));
      }
      const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: data });
      document.querySelector('.day-page .prose').dispatchEvent(paste);
    }"""
    image_type = "(i) => fetch(document.querySelectorAll('.image-block img')[i].src).then((r) => r.blob()).then((b) => b.type)"
    web_day = local_date(page, -4)
    page.locator(f'.heatmap .cell[data-date="{web_day}"]').click()
    expect(page).to_have_url(re.compile(web_day))
    expect(page.locator(".prose")).to_have_text("")
    page.locator(".journal-rest").click()
    expect(page.locator(".prose")).to_be_focused()
    page.keyboard.type("Reaction:")
    page.evaluate(paste, {"types": {"text/plain": "https://giphy.com/gifs/cat-dance-ABC123"}})
    expect(images).to_have_count(1)
    expect(images.first).to_have_attribute("alt", "cat-dance")
    page.wait_for_function("document.querySelector('.image-block img').naturalWidth === 40")
    assert page.evaluate(image_type, 0) == "image/gif"
    assert fetched == ["https://giphy.com/gifs/cat-dance-ABC123"], fetched
    page.evaluate(paste, {"types": {"text/html": '<meta charset="utf-8"><img src="https://media.tenor.com/abc/cat-dance.gif">'}, "png": True})
    expect(images).to_have_count(2)
    page.wait_for_function("document.querySelectorAll('.image-block img')[1]?.naturalWidth === 40")
    assert page.evaluate(image_type, 1) == "image/gif"
    assert fetched[-1] == "https://media.tenor.com/abc/cat-dance.gif", fetched
    # One that can't be fetched is pasted as the link it is. A link to a page that isn't an image
    # is left to the editor to paste as text (which a paste made by a script doesn't do), unfetched.
    page.evaluate(paste, {"types": {"text/plain": "https://example.org/missing.gif"}})
    expect(page.locator(".notice")).to_have_text(re.compile("Couldn't add the image from example.org. There's no image at example.org/missing.gif."))
    expect(page.locator(".prose")).to_contain_text("https://example.org/missing.gif")
    page.evaluate(paste, {"types": {"text/plain": "https://arxiv.org/abs/2410.01234"}})
    page.wait_for_timeout(300)
    expect(images).to_have_count(2)
    assert len(fetched) == 3, fetched
    page.unroute(re.compile(r"/api/image\?"))
    page.screenshot(path=f"{OUT}/{BROWSER}-17-web-images.png")
    page.get_by_role("button", name="Today", exact=True).click()
    step("a pasted Giphy link or a picture copied from a page is fetched by the server and kept as the GIF it is; one that can't be is pasted as a link; other links aren't fetched")

    boxes.nth(1).locator(".label-chip").click()
    page.get_by_role("button", name=re.compile("Rename or recolor")).click()
    page.get_by_role("button", name="Delete label…", exact=True).click()
    expect(page.locator(".label-delete p")).to_have_text("Boxes on 1 day lose this label. Their notes stay.")
    page.get_by_role("button", name="Delete label", exact=True).click()
    expect(boxes.nth(1).locator(".label-chip")).to_have_text("Add label")
    expect(boxes.nth(1)).to_contain_text("Smith et al. 2024")
    page.get_by_role("link", name="By label").click()
    expect(page.get_by_role("navigation", name="Labels").get_by_role("link")).to_have_text(["lecture", "meeting"])
    step("deleting a label takes it off its boxes and out of the label tabs; the notes stay")

    browser.close()

report()
