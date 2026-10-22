# How Skipz works

You open a video. The page script asks the background worker: "is there a sponsor here?" The worker reads the page you have open, once, and answers with a mark or with nothing.

## The four signs

| Sign | Where it comes from | What it gives |
|---|---|---|
| Paid-promotion label | The badge YouTube shows | "A brand paid." No name, no time. |
| Description | Sponsor lines, links and deal codes in the first lines | The brand, often its web address |
| Chapters | A chapter named after the brand | The start of the ad |
| Captions | YouTube's own captions, read in your tab | Spoken cues, with times |

The captions are the only way to catch an ad that the creator never wrote down. Skipz first asks the page's own interface for them. If YouTube refuses, Skipz presses YouTube's own "Show transcript" button out of sight, reads the lines, and closes the panel again. If that fails too, Skipz goes on with the other three, which carry no times, so it marks nothing rather than guess.

## When there are no captions: listening

Some videos have no captions Skipz can read (a video posted minutes ago, or one whose captions YouTube will not hand over). If you agree, Skipz listens instead:

1. The page script copies five seconds of the video's sound at a time (`captureStream`, never starting or pausing the video).
2. A hidden page of the extension (`src/ears.ts`) turns it into words with a small speech model, and looks for the same cues the captions are searched for (`src/heard.ts`).
3. When it hears "sponsored by …", a second speech model listens again to the last half minute, with the brands already known, to spell the brand right and sharpen the start.
4. Listening only hears an ad as it plays, so Skipz can skip the rest of a read, not its start. To skip it, it jumps ten seconds, listens for three, and repeats until the talk is ordinary again. Undo goes back to where the read began. The mark stays on the timeline, so if you replay the part, Skipz asks about the whole read.

The models are downloaded once, after you say yes. The sound is never recorded, stored or sent. Speech models make mistakes on music and noise: that is why this is beta.

## From signs to a mark

`src/detector/lib/sponsor/check.ts` turns each sign into a vote, combines them, and returns: sponsored or not, the brand, a start, an end and how sure it is. Skipz marks a video only when the answer is at least 70 percent sure and names a brand and a time.

Then `src/verdict.ts` adds a little padding: the mark starts 2 seconds early and ends 3 seconds late, because the reading starts at the sentence that cues the ad and ends at the last line that sells it. We measured these two numbers on 60 videos that other people had also marked by hand.

## Two rules worth knowing

- **A wrong mark costs more than a missed one.** If Skipz is not sure, it says nothing.
- **Skipping by itself is locked** (`src/gate.ts`). It opens only when start times and brand names are right often enough on videos checked by hand, and wrong skips are not growing.

## Test it on your own example

Every rule has a test with a real sentence behind it. To see how a sentence is read, copy a test from `src/detector/lib/sponsor/*.test.ts`, put your own lines in, and run `npm test`.
