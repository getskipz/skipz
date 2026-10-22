# Skipz

Skipz finds the sponsor part of a YouTube video, names the brand, and asks before you skip it.

It works on videos nobody has marked yet, including ones posted an hour ago. It reads what YouTube already shows (the paid-promotion label, the description, the chapters and the video's own captions) on your computer. Nothing leaves your browser. There is no account, no key and no server.

> **Status: beta.** Skipz can miss a sponsor or mark the wrong stretch. It only ever asks. Skipping by itself stays switched off until the numbers say it is safe.

## What you get

- **A yellow mark on the timeline** over the sponsor part, with the brand's name.
- **A prompt a moment before it starts:** "Skip it?" with two big buttons. Undo is one press.
- **Three modes in the toolbar popup:** Ask me, Skip by itself (locked for now), Off.

## How it decides

Skipz combines four signs and marks a sponsor only when it is sure enough:

1. YouTube's own "includes paid promotion" label.
2. Sponsor lines and links in the description.
3. Chapters named after a brand.
4. Spoken ad reads in the video's captions ("this video is sponsored by …", a deal code, "link in the description").

The rules are plain text patterns and a few thresholds. You can read them in [`src/detector/lib/sponsor/`](src/detector/lib/sponsor/). [How it works](docs/HOW-IT-WORKS.md) walks through one video.

## Privacy

Skipz asks Chrome for three things: `storage` (your mode and counters), `scripting` (to read the page you have open) and access to `youtube.com`. It sends nothing anywhere. [Details](docs/PRIVACY.md).

## Install

Chrome Web Store: coming soon. Until then, from source:

```
git clone https://github.com/getskipz/skipz.git
cd skipz
npm install
npm run build
```

Then open `chrome://extensions`, switch on **Developer mode**, press **Load unpacked** and choose the `dist` folder.

**Firefox (desktop, and Android later):** `npm run build:firefox` writes `dist-firefox`. In Firefox open `about:debugging`, choose **This Firefox**, press **Load Temporary Add-on** and pick `dist-firefox/manifest.json`. It passes Mozilla's add-on checker with no errors or warnings. It also runs on the mobile site (`m.youtube.com`), which is what Firefox for Android opens. Not yet tested on a phone.

## Test it by hand: the best way to give back

A test suite cannot open YouTube on your phone. You can. A three-minute check on your own device, or on a video where Skipz got it wrong, improves Skipz for everyone, and it needs no code. Every report becomes a test that keeps the fix in place, and you are credited. **Nobody has run Skipz on a real phone yet: the first mobile testers matter most.** Start with [docs/TESTING.md](docs/TESTING.md).

## Help make it better

The most useful contribution takes two minutes: tell us about a video where Skipz was wrong.

- **A sponsor Skipz missed:** use the "Missed sponsor" issue form.
- **A mark in the wrong place, or a wrong skip:** use the "Wrong mark" form.
- **You can write code:** read [CONTRIBUTING.md](CONTRIBUTING.md). Every rule change needs a real example behind it, so each report you send becomes a test that keeps the fix in place.

Contributors are listed in [CONTRIBUTORS.md](CONTRIBUTORS.md) with the fix they made.

## Who runs this

Skipz is run by one person for now: Yx. I read every report. Replies can take a few days, and I will say so here if I am away. Skipz is not backed by a company, so the best thing you can do is test it and tell me what you find.

## Licence

[Apache License 2.0](LICENSE). Skipz is free to use, change and share. The name Skipz and its logo are not part of the licence.

Skipz is not affiliated with or endorsed by YouTube or Google.
