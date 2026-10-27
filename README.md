# Piano app

A free piano-learning web app for personal use. It shows a song's sheet music, listens to your digital piano over
USB, and walks through the song in **wait mode**: the cursor only moves on when you press the right notes. An
on-screen keyboard shows which keys to press and with which finger.

Built with Vite, React and TypeScript. The sheet music is drawn by
[OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) from MusicXML files, and your piano is read with the
browser's Web MIDI API. There is no backend: everything runs in your browser.

## Requirements

- **Desktop Chrome.** Web MIDI works in Chrome on a computer. It does **not** work on iPhone or iPad browsers, so a
  phone version would need a native build (not done yet).
- **A digital piano connected by USB.** Without one you can still try the app with the on-screen keyboard keys below.
- **Node.js** (on a Mac: `brew install node`).

## Run it

In a terminal, from this folder:

```bash
npm install     # once
./start.sh      # starts the app and opens Chrome
```

`./start.sh` always uses port **5173**. Your saved fingerings, loop and hand choice are stored in the browser under
that exact address, so a different port would look like lost data. You can also run `npm run dev` yourself.
Stop the app with `Ctrl+C`.

Open http://localhost:5173 and allow the MIDI permission when Chrome asks.

## Using it

- **Hand switch** (top left): *Right hand*, *Left hand* or *Both*. Right-hand keys are blue and left-hand keys are
  orange. Switching keeps your place in the piece.
- **Wait mode:** play the highlighted keys. A correct note advances the cursor; a wrong note is ignored.
  Chords can be played in any order.
- **Key feedback:** keys you press turn green when right and red when wrong, and the notes in the score are coloured
  to match. A wrong key shakes. Colours fade about a third of a second after you let go.
- **Click the score** to jump to that spot.
- **Loop:** press *Loop…*, click the first measure, then the last measure. The measures are highlighted, and the
  cursor goes back to the start of the loop after its last note. *Stop loop* ends it. The loop is remembered per song.
- **→ (right arrow)** skips the current notes. **Esc** cancels choosing a loop.
- **Fingering:** the keyboard shows a suggested finger on each target key. To change one, jump to the note and press
  `1`–`5` (for a chord the digits fill the notes from the lowest up). Corrections are saved per hand and re-route the
  suggestions around them. *Export* / *Import* / *Clear* are under **Help, fingering and MIDI**.

### No piano handy? Dev keyboard

In development mode your computer keyboard plays notes: `A W S E D F T G Y H U J K O L P ;` are the keys from middle C
upwards (home row = white keys, row above = black keys), and `Z` / `X` move down / up an octave.

## Songs

Songs are MusicXML files in [`public/songs/`](public/songs). The app opens `ode-to-joy.musicxml`, a short
public-domain demo, by default.

To practise your own piece, export it as MusicXML (`.musicxml`, from MuseScore or similar), put it in
`public/songs/`, and open it with `?song=<file name without .musicxml>`, for example
`http://localhost:5173/?song=my-song`. To make it the default on your computer, create a file named `.env.local` in
this folder (it is never committed) containing:

```
VITE_DEFAULT_SONG=my-song
```

Scores recognised from a PDF often need repairing. Check that the key and time signatures, clef changes and rests
match the original before relying on one; clef changes in the left hand are a common problem.

## How it works

| File | What it does |
| --- | --- |
| `src/SheetMusic.tsx` | Draws the score with OSMD, follows the cursor, handles clicks and the loop highlight |
| `src/waitMode.ts` | Wait mode: which notes are required, advancing, jumping, skipping, looping, hand switching |
| `src/midi.ts`, `src/useMidi.ts` | Web MIDI: parses note messages from the piano |
| `src/useKeyboardPiano.ts` | The dev keyboard that stands in for a piano |
| `src/Keyboard.tsx`, `src/keyboardLayout.ts` | The on-screen piano with targets, fingers and key feedback |
| `src/scoreFeedback.ts` | Colours note heads in the score for the key feedback |
| `src/fingering.ts` | Fingering suggestions by dynamic programming (the left hand uses a mirrored model) |
| `src/corrections.ts` | Fingers you set by hand, saved in the browser, with export and import |
| `src/App.tsx` | Puts it all together |

## Checks

```bash
npm run lint    # oxlint
npm run build   # type-check and production build
```

## Known limits

- Fingering suggestions are a simple model: good for stepwise passages, rougher for fast broken chords and big
  jumps. Correct them by hand where needed.
- iPhone: Web MIDI is not supported by iOS browsers, so a native app would be needed.

## Status

A personal project. No license has been chosen, so all rights are reserved: you can read the code, but you do not
have permission to reuse it.
