#!/usr/bin/env python3
"""Low points card game (CLI).

Rules implemented from prompt:
- Each player starts with 5 cards.
- Remaining cards form a face-down draw pile.
- On each turn, player may either:
  - draw one card from draw pile, or
  - pick the previous player's ejected card group (top discard group).
- Then player must eject/discard one or more cards that all have the same rank.
- Card points: A=1, 2-10 as number, J/Q/K=10, Joker=0.
- A player may call "show" on their turn to end the round.

Round scoring on show:
1) If shower has strictly lower total than every other player:
   - shower gets 0 points for that round
   - every other player gets their hand total added
2) Otherwise:
   - shower gets 50 points
   - any player with total <= shower total gets 0
   - players with total > shower total get their hand total added

Game supports multiple rounds and cumulative scores.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Dict, List


RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
SUITS = ["H", "D", "C", "S"]


@dataclass(frozen=True)
class Card:
    rank: str
    suit: str

    def points(self) -> int:
        if self.rank == "JOKER":
            return 0
        if self.rank == "A":
            return 1
        if self.rank in {"J", "Q", "K"}:
            return 10
        return int(self.rank)

    def short(self) -> str:
        if self.rank == "JOKER":
            return "JOKER"
        return f"{self.rank}{self.suit}"


@dataclass
class Player:
    name: str
    hand: List[Card] = field(default_factory=list)
    total_score: int = 0

    def hand_points(self) -> int:
        return sum(card.points() for card in self.hand)


class LowPointsGame:
    def __init__(self, player_names: List[str], rounds: int, seed: int | None = None) -> None:
        if len(player_names) < 2:
            raise ValueError("At least 2 players are required")
        self.players = [Player(name=n) for n in player_names]
        self.rounds = rounds
        self.random = random.Random(seed)
        self.draw_pile: List[Card] = []
        self.discard_groups: List[List[Card]] = []

    def build_deck(self) -> List[Card]:
        deck = [Card(rank=r, suit=s) for r in RANKS for s in SUITS]
        deck.append(Card(rank="JOKER", suit=""))
        deck.append(Card(rank="JOKER", suit=""))
        self.random.shuffle(deck)
        return deck

    def start_round(self) -> None:
        deck = self.build_deck()
        for p in self.players:
            p.hand = [deck.pop() for _ in range(5)]
        self.draw_pile = deck
        self.discard_groups = []

    @staticmethod
    def render_cards(cards: List[Card]) -> str:
        return " ".join(card.short() for card in cards)

    def show_table_state(self, current_player: Player) -> None:
        print("\n" + "=" * 64)
        print(f"Turn: {current_player.name}")
        print(f"Draw pile cards left: {len(self.draw_pile)}")
        if self.discard_groups:
            top = self.discard_groups[-1]
            print(f"Top discard group ({len(top)}): {self.render_cards(top)}")
        else:
            print("Top discard group: <empty>")
        print("=" * 64)

    def show_hand(self, player: Player) -> None:
        indexed = [f"[{i}] {card.short()}" for i, card in enumerate(player.hand)]
        print(f"{player.name}'s hand ({len(player.hand)} cards, points now {player.hand_points()}):")
        print("  " + " | ".join(indexed))

    def prompt_draw(self) -> str:
        while True:
            choice = input("Choose action: draw from (p)ile, take (d)iscard, or (s)how: ").strip().lower()
            if choice in {"p", "d", "s"}:
                return choice
            print("Invalid input. Enter p, d, or s.")

    def draw_for_player(self, player: Player, choice: str) -> bool:
        if choice == "s":
            return True

        if choice == "p":
            if not self.draw_pile:
                print("Draw pile is empty. You must take discard if available.")
                return False
            drawn = self.draw_pile.pop()
            player.hand.append(drawn)
            print(f"Drew from pile: {drawn.short()}")
            return False

        if not self.discard_groups:
            print("No discard group available. Choose pile or show.")
            return False

        group = self.discard_groups.pop()
        player.hand.extend(group)
        print(f"Took discard group: {self.render_cards(group)}")
        return False

    def prompt_discard(self, player: Player) -> List[Card]:
        while True:
            self.show_hand(player)
            raw = input(
                "Enter card index or comma-separated indices to discard (all same rank, e.g. 0 or 1,3): "
            ).strip()
            if not raw:
                print("Please enter at least one index.")
                continue

            parts = [p.strip() for p in raw.split(",")]
            if any(not p.isdigit() for p in parts):
                print("Indices must be numbers.")
                continue

            indices = [int(p) for p in parts]
            if len(set(indices)) != len(indices):
                print("Duplicate indices are not allowed.")
                continue

            if any(i < 0 or i >= len(player.hand) for i in indices):
                print("One or more indices are out of range.")
                continue

            selected = [player.hand[i] for i in sorted(indices)]
            ranks = {c.rank for c in selected}
            if len(ranks) != 1:
                print("All discarded cards must have the same rank.")
                continue

            for i in sorted(indices, reverse=True):
                player.hand.pop(i)
            return selected

    def score_show(self, shower_index: int) -> Dict[str, int]:
        round_scores: Dict[str, int] = {}
        shower = self.players[shower_index]
        shower_points = shower.hand_points()
        others = [p for i, p in enumerate(self.players) if i != shower_index]

        strict_lowest = all(shower_points < p.hand_points() for p in others)

        if strict_lowest:
            for i, p in enumerate(self.players):
                if i == shower_index:
                    round_scores[p.name] = 0
                else:
                    round_scores[p.name] = p.hand_points()
            return round_scores

        for i, p in enumerate(self.players):
            if i == shower_index:
                round_scores[p.name] = 50
            else:
                pts = p.hand_points()
                round_scores[p.name] = 0 if pts <= shower_points else pts
        return round_scores

    def play_round(self, round_number: int) -> None:
        self.start_round()
        print(f"\n########## ROUND {round_number} ##########")

        turn = 0
        show_called_by = -1

        while True:
            player = self.players[turn % len(self.players)]
            self.show_table_state(player)
            self.show_hand(player)

            while True:
                choice = self.prompt_draw()
                show_called = self.draw_for_player(player, choice)
                if show_called:
                    show_called_by = turn % len(self.players)
                    break
                if choice == "p" and player.hand:
                    break
                if choice == "d" and player.hand:
                    break

            if show_called_by != -1:
                break

            discarded = self.prompt_discard(player)
            self.discard_groups.append(discarded)
            print(f"Discarded group: {self.render_cards(discarded)}")

            turn += 1

        shower = self.players[show_called_by]
        print(f"\nSHOW called by {shower.name}. Revealing all cards:")
        for p in self.players:
            print(f"- {p.name}: {self.render_cards(p.hand)} -> {p.hand_points()} points")

        round_scores = self.score_show(show_called_by)
        print("\nRound score additions:")
        for p in self.players:
            add = round_scores[p.name]
            p.total_score += add
            print(f"- {p.name}: +{add} (total {p.total_score})")

    def play(self) -> None:
        for r in range(1, self.rounds + 1):
            self.play_round(r)

        print("\n========== FINAL TOTALS ==========")
        ranking = sorted(self.players, key=lambda p: p.total_score)
        for i, p in enumerate(ranking, start=1):
            print(f"{i}. {p.name}: {p.total_score}")
        print(f"Winner: {ranking[0].name} (lowest total points)")


def read_int(prompt: str, min_value: int, max_value: int) -> int:
    while True:
        raw = input(prompt).strip()
        if raw.isdigit():
            val = int(raw)
            if min_value <= val <= max_value:
                return val
        print(f"Enter a number from {min_value} to {max_value}.")


def main() -> None:
    print("Low Points Card Game")
    num_players = read_int("Number of players (2-8): ", 2, 8)
    rounds = read_int("Number of rounds (1-20): ", 1, 20)

    player_names: List[str] = []
    for i in range(1, num_players + 1):
        name = input(f"Player {i} name: ").strip() or f"Player{i}"
        player_names.append(name)

    game = LowPointsGame(player_names=player_names, rounds=rounds)
    game.play()


if __name__ == "__main__":
    main()
