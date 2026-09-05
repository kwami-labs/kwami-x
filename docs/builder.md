# Program builder

A Kwami owner can attach one sub-program that the vault invokes at lifecycle moments. This is what turns "guess the phrase" into an authorable financial game.

## What an extension can do

Escalate the ticket price with every failed attempt. Split payouts between several winners. Run a jackpot that only pays on the tenth loss. Gate entry to holders of another token. Distribute whatever is left when the Kwami dies.

## What an extension cannot do

The contract is deliberately narrow. An extension is called **after** the vault has already applied its own rules, is passed a read-only view of the session, and has **no authority over the vault PDA**. It can maintain its own state and move its own funds; it cannot reach into the pot.

That boundary is what makes it safe to let a language model write one. A bad extension can break the owner's game. It cannot drain it.

## Hooks

| Hook             | When                                                  |
| ---------------- | ----------------------------------------------------- |
| `onSessionStart` | After a ticket is paid and the session account exists |
| `onWin`          | After a payout settles — receives the amounts paid    |
| `onExpire`       | When a session is settled unwon                       |
| `onDeath`        | Once, when a Kwami crosses a death threshold          |

Selected hooks are stored as a bitmask on the `Extension` account.

## Generating one

`/builder/<mint>` takes a plain-language brief and returns Anchor source. The model is given `EXTENSION_RULES` verbatim, and **the same list is shown to the owner beside the result** — so the person approving the deploy is checking against exactly what the generator was working from.

The rules:

1. Never hold authority over the Kwami vault PDA, request it as a signer, or attempt to move lamports out of it.
2. Every arithmetic operation uses `checked_*` or `saturating_*` — an overflow in a financial game is a free withdrawal.
3. All state lives in PDAs seeded by the Kwami mint, so two Kwamis running the same extension cannot collide.
4. Hook instructions must be callable only by the vault program; verify the caller.
5. A hook must never fail for a reason outside its own logic — a panic reverts the whole settlement and traps the player's payout.
6. No unbounded loops, no unbounded `Vec` growth, no dynamic account allocation inside a hook.
7. No upgrade authority after deploy, or the immutability a Kwami advertises is a fiction.

### The response is a stream

A generation takes a minute or more and spends most of it reasoning before the first line of Rust
exists. A route that waited and answered once would show a spinner for that whole minute — and a
spinner cannot be told apart from a hang, so the honest reading of it is "this is broken".

`/api/builder/generate` streams instead: the model's summarised reasoning, then the source, as
they arrive. `shared/codegen/` holds the vocabulary both ends speak — `config.ts` for the model
allow-list and the thinking configuration, `activity.ts` for the wire format — so the browser
transport and the Nitro route cannot drift into a request the API rejects with a 400 the owner
reads as a broken builder. The structure mirrors the codegen split used in nexow: a contract
module both ends import, a route that owns the API key, and a client that owns the rendering.

The format is newline-delimited JSON, not `text/event-stream`. SSE frames are delimited by a
blank line and the payload here is Rust source _with blank lines in it_, so every empty line in a
generated program would have to be escaped or would silently split a frame. JSON escapes newlines
for free.

Two details that only matter once something goes wrong:

- **`display: 'summarized'`.** The adaptive models default to `omitted`, which streams _empty_
  thinking blocks — the model reasons for thirty seconds and the UI has nothing to show. That is
  the failure the stream exists to prevent, so the config asks for summaries explicitly.
- **Failures travel in the stream.** A streaming route answers 200 the moment it opens, so an
  upstream failure after that has no status code left to travel in. Without an explicit `error`
  record the browser cannot distinguish "the model finished" from "the connection died before it
  said anything" — and that difference decides whether the owner should retry.

The API key never leaves the server, which is the whole reason this is a route rather than a
direct call from the builder page.

## The model writes it; a human deploys it

That separation is not a limitation waiting to be engineered away. A generated program that moves other people's money should be read by its owner before it goes near a cluster.

```
1. anchor build
2. anchor deploy, then remove the upgrade authority
3. register_extension against the Kwami
4. publish — the rules are fixed from that moment
```

## Registration is one-way, and only before first publish

`register_extension` requires `state == Minted` and refuses if an extension is already set. A challenger who reads the rules before paying is guaranteed those are the rules that settle their session.

The `Extension` account records the SHA-256 of the deployed binary at registration time, so anyone can re-derive it from the ledger and prove the code was never swapped.

## Writing one by hand

`shared/builder/extension-abi.ts` exports `EXTENSION_TEMPLATE` — the scaffold, with the hook signatures the vault calls by discriminator. Keep those signatures exactly as given; everything else is yours.
