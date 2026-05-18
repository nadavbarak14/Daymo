# A tour of Wikipedia

*A four-scene walkthrough of en.wikipedia.org — using the Python article to show how every Wikipedia page is built.*

**URL:** https://en.wikipedia.org/wiki/Python_(programming_language)

## Contents

1. [Scene 1: Anatomy of an article](#1-scene-1-anatomy-of-an-article)
2. [Scene 2: The body — sections, code, images](#2-scene-2-the-body-sections-code-images)
3. [Scene 3: Citations and references](#3-scene-3-citations-and-references)
4. [Scene 4: The page chrome — tabs, actions, languages, history](#4-scene-4-the-page-chrome-tabs-actions-languages-history)
5. [Scene 5: Searching Wikipedia](#5-scene-5-searching-wikipedia)

---

## 1. Scene 1: Anatomy of an article <a id="1-scene-1-anatomy-of-an-article"></a>

### 1.1 Land on the article

Wikipedia — the largest reference work ever written. Sixty million articles across three hundred languages, all built on the same skeleton. Let's look at it.

### 1.2 The title

Every article starts the same way — a bold title, top of the page, matching the URL slug.

1. Look at **the article title at the top of the page**.
2. Notice **the article's title**.

### 1.3 The lead paragraph

Right below the title sits the lead — a few paragraphs that summarize the whole article. If you only read one thing, this is it.

1. Look at **the lead paragraph**.
2. Notice **the lead — a self-contained summary**.

### 1.4 The infobox

On the right: the infobox. Structured facts pulled out of the prose — designer, release date, file extensions, paradigms — scannable at a glance.

1. Look at **the infobox on the right**.
2. Notice **structured facts at a glance**.

### 1.5 The table of contents

On the left, sticky as you scroll: the table of contents. Built automatically from every heading in the article — and every entry is a deep link.

1. Look at **the sticky table of contents on the left**.
2. Notice **the table of contents — every section, in order**.

## 2. Scene 2: The body — sections, code, images <a id="2-scene-2-the-body-sections-code-images"></a>

### 2.1 Open the article

### 2.2 Scroll into the body

### 2.3 A section heading

Below the lead, the body is sliced into sections. Each heading is a stable anchor — the ones in the URL after the hash.

1. Look at **the History section heading**.
2. Notice **a top-level section — H2**.

### 2.4 An image with caption

Images aren't bare — every one carries a caption underneath, and a link through to the file page where it was uploaded.

1. Look at **an inline image with a caption**.
2. Notice **image plus caption**.

### 2.5 Scroll to the code sample

### 2.6 A code block

Articles about programming languages include real code — syntax-highlighted server-side, no JavaScript needed, and copy-pasteable.

1. Look at **a syntax-highlighted code sample**.
2. Notice **a code block — syntax-highlighted server-side**.

## 3. Scene 3: Citations and references <a id="3-scene-3-citations-and-references"></a>

### 3.1 Open the article

### 3.2 Scroll to a citation

### 3.3 An inline citation

Wikipedia's defining rule: every claim is sourced. These little bracketed numbers are footnotes — click one to jump to the source.

1. Look at **an inline citation in the prose**.
2. Notice **a footnote marker — like [1]**.

### 3.4 Jump to the references section

### 3.5 The references list

Scroll to the bottom and every footnote resolves into a full citation — title, author, publisher, date, plus a link to verify it yourself.

1. Look at **the full references list at the bottom**.
2. Notice **every footnote, resolved**.

### 3.6 A single reference

This is what makes Wikipedia auditable — not the writing, but that every line of it points at a primary source.

1. Look at **one citation entry**.
2. Notice **one citation, fully expanded**.

## 4. Scene 4: The page chrome — tabs, actions, languages, history <a id="4-scene-4-the-page-chrome-tabs-actions-languages-history"></a>

### 4.1 Land on the article

### 4.2 Article and Talk tabs

Every article has a shadow — the Talk page. Editors argue, plan, and resolve disputes there, separate from the article itself.

1. Look at **the Article and Talk tabs**.
2. Notice **Article tab — where we are now**.
3. Notice **Talk tab — discussion behind the article**.

### 4.3 Read, Edit, View history

Three actions on every page: read it, edit it, or open its history. Anyone can click edit. We're about to click history.

1. Look at **the action tabs**.
2. Notice **Edit — anyone can change this page**.
3. Notice **View history — every revision ever made**.

### 4.4 The languages button

And this button — every article exists in dozens of other languages. They aren't translations of each other; each is independently written and maintained.

1. Look at **the languages button**.
2. Notice **translated into dozens of languages**.

### 4.5 Open the history page

1. Click **clicking View history**.

### 4.6 The revision list

Every edit since the article was created — author, timestamp, byte delta, and the editor's summary of what they changed. Thousands of revisions deep.

1. Look at **the revision history**.
2. Notice **every edit ever made to this page**.

### 4.7 Compare revisions

Pick any two revisions, hit compare, and you get a side-by-side diff of exactly what changed. This is the audit trail that holds the whole project together.

1. Look at **the compare-revisions button**.
2. Notice **tick two rows, hit compare, get a diff**.

## 5. Scene 5: Searching Wikipedia <a id="5-scene-5-searching-wikipedia"></a>

### 5.1 Land on the article

### 5.2 The search box

Every page on Wikipedia carries the same search bar in the header — it spans the whole encyclopedia Like A boss.

1. Look at **the global search input in the header**.
2. Notice **site-wide search — every article, every language**.

### 5.3 Type a query

Start typing and you get live suggestions — matching article titles, redirects, even section anchors.

1. Click the target element. *(no description — line 216)*
2. Type **"Turing machine"**.

### 5.4 Submit the search

Hit enter and you land on the article — or, when it's ambiguous, on a full-text results page across the entire encyclopedia.

---

## Warnings

- line 216: click has no description (selector: #searchInput)
