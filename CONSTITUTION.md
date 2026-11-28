# The Keyhandoff constitution

[Русская версия](CONSTITUTION.ru.md)

Why Keyhandoff exists and the rules it grows by. Every feature, every piece of text and every decision is checked
against this document. It changes rarely and on purpose — in a commit of its own that explains why.

## In one sentence

**Keyhandoff is a keyring your AI agents use for you.** You no longer remember, write down or copy-paste access:
agents take it from Keyhandoff and put new keys there themselves.

## Who it is for

Anyone who builds together with Claude Code, Codex, Cursor and other agents — with a few VPSs, domains, databases,
API tokens and per-project `.env` files, and access scattered across notes, chats and files. One person and their
computers; not a team, not a company.

## The problem

Agents need keys all the time, and the person becomes a courier: digging a password out of notes, pasting it into
the chat, then forgetting where the agent saved the new one. Secrets settle in chat history, logs and project files.

## The promise

**Convenience first.** Access moves between you and your agents by itself, without relying on anyone's memory.

**Safety is the condition, not the headline.** Agents are never shown secret values — that is the only reason they
can be trusted with keys at all. It is the foundation of the product, not its pitch.

## Principles

When two conflict, the lower number wins.

1. **Values never reach the agent.** Agents work with names; values go straight into the command. No path open to
   an agent — command, skill or MCP tool — returns a secret value. Not even for convenience.
2. **A person has the last word.** Revealing, copying, deleting and exporting a key take a fingerprint. Everything
   agents do is visible in the audit log and in the menu bar key.
3. **You are not the courier.** If an agent can do it, the agent does it: use access, save a new key, file it on the
   right shelf, remind you about a payment. Every feature is judged by one question: does the person think about
   keys less?
4. **Everything stays with you.** One encrypted file on your computer. No server, no account, no subscription, no
   telemetry. Keyhandoff goes online only when you ask — to update, or to sync through a folder of your own.
5. **Zero setup.** Installed by one sentence to an agent or one line in a terminal. Works on Mac, Windows and Linux,
   in English and Russian.
6. **Small and readable.** No dependencies, no build step. You can read a password manager's whole code in an
   evening — so every new feature has to earn its lines.
7. **Honest about limits.** We promise only what we do, and write the limits next to the promises: not audited, no
   protection from malware running as you.
8. **A calm interface.** Minimal, glassy, dark by default, no extra buttons. Human words instead of jargon.

## What Keyhandoff is not

- **Not a cloud password manager.** It doesn't replace a family 1Password and doesn't fill forms in your browser.
- **Not a team secrets manager.** Not Vault, Doppler or Infisical: no server, no roles, no sharing.
- **Not a sandbox.** It prevents accidental leaks, not an agent that deliberately sets out to steal a key.
- **Not a service.** The core is always free and open source (MIT). Your keys go nowhere but your own computer.

## How we talk

- Person to person. The benefit first, the mechanics after.
- Plain words — "access", "keys", "passwords" — on the first screen; terms belong in "how it works".
- No scare headlines: no "leaks", no "breaches". We take a worry away, we don't add one.
- Agents **use** your access; they don't "grab your keys" — that sounds unsafe.
- Concrete, real-life examples: "deploy to prod", "a new database password", "the VPS is due in three days".
- The name is Keyhandoff: keys are handed off between you and your agents without you in the middle. In Russian
  it is «Связка», a bunch of keys. Lowercase `keyhandoff` only in commands and URLs.

## The decision filter

Before building a feature or writing a text, answer five questions:

1. Will the person think about keys less?
2. Does the agent still never get the value?
3. Does it work without a server or an account?
4. Does it install without setup on all three systems?
5. Is it worth its lines of code?

One "no" — rework it or drop it.
