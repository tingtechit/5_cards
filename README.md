# 5 Cards

Local card game (no online mode). Bots are optional.

## Run

Open:

- `/Users/akbar.rahmanbasha/Library/CloudStorage/OneDrive-SyneosHealth/Documents/Codex/index.html`

## Rules Implemented

- Each player starts with 5 cards.
- Turn flow: **discard first**, then **draw**.
- Discard can be 1 or many cards, but all must be same rank.
- After discarding, player can:
  - draw one from draw pile, or
  - pick exactly one card from **previous player's last discard**.
- If draw pile is empty, all discarded cards are shuffled into new pile.
- `A=1`, `2..10` face value, `J/Q/K=10`, `Joker=0`.
- `Show` can be called in discard phase.

## UI Features

- Drag to reorder your cards.
- Separate panels for:
  - previous player's discard
  - current player's discard
- Every player's last discarded cards are shown.
- Previous player's tile is highlighted each turn.
- Bot hands stay face-down on screen.
- Dramatic suspense reveal when you call show:
  - opponents revealed one-by-one in ascending points
  - final win/lose effect animation
