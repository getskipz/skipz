# Privacy

**Skipz sends nothing about you or what you watch anywhere. It has no server, no account, no analytics and no tracking, and it does not ask for a key. The only thing it ever fetches is two small listening models, once, and only if you say yes (see "Listening" below).**

## What it reads

On a YouTube video page only: the paid-promotion label, the description, the chapters and the video's own captions. It reads them in your browser to decide whether to mark a sponsor.

## Listening
When a video has no captions Skipz can read, it asks once whether it may listen instead. If you say yes, it downloads two small speech models from a public model library (huggingface.co), once. After that it hears the sound of the video you are watching, five seconds at a time, in a page of the extension on your own computer, turns it into words, and drops the sound. Nothing is recorded, stored or sent. You can switch listening off any time in the Skipz popup.

## What it keeps

Your mode (Ask me, Skip by itself, Off) and three counters (looked at, marked, skipped), in your browser's own storage. Remove the extension and they are gone.

## Permissions, and why

| Permission | Why |
|---|---|
| `storage` | Keeps your mode and counters |
| `scripting` | Reads the video page you have open |
| `offscreen` | A hidden page that runs the listening models, so they do not slow your video page |
| `https://www.youtube.com/*` and `https://m.youtube.com/*` | The only sites Skipz runs on (the second is YouTube's phone site) |

Skipz does not run on any other site and asks for no other site.

## If this ever changes

A later version may offer an optional, opt-in shared list of sponsor findings. It would show its own screen that says exactly what is shared, and it would stay off until you agree. This page would change first.
