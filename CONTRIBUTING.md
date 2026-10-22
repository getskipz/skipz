# Contributing to Skipz

Thank you for helping. This page tells you how to run the code, how to report a miss, and what a good change looks like.

## Report a miss (no code)

Open an issue with the "Missed sponsor" or "Wrong mark" form. Give the video link, who sponsored it, and the minute where the ad runs. That is enough. We turn each report into a test, so the fix stays fixed.

## Run it

```
npm install
npm test          # unit tests, about 10 seconds
npm run typecheck
npm run build     # writes dist/, load it unpacked in Chrome
```

## What a good change looks like

1. **Start from a real example.** A rule change needs a sentence or a page that really went wrong, copied from a real video. Add it as a test next to the others in `src/detector/lib/sponsor/`.
2. **Show both directions.** Prove the new rule catches the sponsor it missed and leaves ordinary talk alone. "Collaboration with" in a product launch must stay unmarked. A wrong mark costs more than a missed one.
3. **Keep it small.** One idea per pull request.
4. **Sign off your commits** (`git commit -s`). It states that you wrote the change and may share it under the project's licence (the Developer Certificate of Origin).

## What we will not accept

- Anything that sends data off the computer without a clear, opt-in screen.
- Anything that hides what Skipz is doing, or works around a site's checks.
- Code from projects whose licence does not allow it here. SponsorBlock's data is licensed for non-commercial use only and stays out of this project.

## Be kind

Read the [Code of Conduct](CODE_OF_CONDUCT.md). Disagree with the idea, not the person.
