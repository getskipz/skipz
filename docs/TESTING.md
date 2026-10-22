# Test Skipz by hand: the most useful thing you can give back

Automatic tests can read a sentence and check a rule. They cannot open YouTube on your phone, watch a real ad, or tell that the "Skip it?" button sits on top of a button you needed. You can. Three minutes of checking tells us more than a week of guessing, and every report you send becomes a test that keeps the fix in place.

You do not need to read any code.

## The three-minute check

1. Install Skipz (see the [README](../README.md)).
2. Open a video that has a sponsor read. Any creator who says "this video is sponsored by" will do.
3. Look for **a yellow mark** along the bottom of the video, over the sponsor part.
4. Play to a few seconds before it. Look for **"Skip it? / Keep watching"**.
5. Press **Skip it**. Did the video jump past the ad? Press **Undo**. Did it come back?
6. Open a video with **no** sponsor. Did Skipz leave it alone?

## Tell us what you saw

Use one of the forms under **Issues**:

- **Mobile check:** one form for phones and tablets. It asks which phone and browser, and four yes-or-no questions. A "no" is as useful as a "yes".
- **Missed sponsor:** a video with a sponsor and no mark.
- **Wrong mark:** a mark in the wrong place, or on a video with no sponsor.

Share the video link, not your history. Skipz never needs anything private.

## Phones: who we are looking for

Skipz runs in Firefox for Android. Nobody has run it on a real phone yet, so **the first few mobile checks matter most**. If you have an Android phone with Firefox, you can be one of the first. Say what worked and what did not. We read every one.

## What happens to your report

A maintainer reads it, writes the video into a test, fixes the rule or the layout, and adds your name to [CONTRIBUTORS.md](../CONTRIBUTORS.md) with what you found. When the fix ships, the release notes say so.
