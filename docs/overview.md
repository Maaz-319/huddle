# Discord Channels — Project Overview

## What This Is

A simplified version of Discord: users create servers, organize conversations into channels, chat in real time, and see who's currently online. No voice, no video, no bots — just the core of how a live community chat app works.

## The Story

A user creates a **server** (think: a community, like "CS Study Group"). That user is the **owner**. The owner invites people in, sets up **channels** inside the server (like `#general`, `#assignments`, `#random`), and decides who gets to do what.

Once inside, members pick a channel and start chatting. Messages appear instantly for everyone in that channel — no refreshing, no waiting. A sidebar shows who's online right now with a live green dot.

## Core Features

**Servers**
- Any user can create a server and becomes its owner.
- The owner invites other users to join.

**Channels**
- The owner decides who is allowed to create channels: only themselves, everyone in the server, or a hand-picked list of trusted members.
- Some channels can be made private/invite-only, visible only to specific members rather than the whole server.

**Roles & Permissions**
- Three levels: **Owner**, **Moderator**, **Member**.
- The owner can promote members to moderator.
- Moderators can manage channels and moderate messages; members can chat and view.
- Individual channels can override the server's default rules (e.g., a channel that's mod-only even though the server is open to everyone).

**Messaging**
- Post plain text messages in a channel.
- Messages show up live for everyone watching that channel.
- Users can edit or delete their own messages.
- Moderators and the owner can delete any message in channels they oversee (basic moderation).
- Scrolling up loads older message history.
- A "so-and-so is typing..." indicator appears while someone is composing a message.

**Presence**
- Every user has one online/offline status, visible across the whole server.
- The green dot updates live as people come online or go offline.

## What's Out of Scope

- Voice or video calls
- Screen sharing
- Bots, integrations, or slash commands
- Rich media embeds, reactions, threads
- Per-server presence (a user is either online or not, everywhere)

## Why This Project Is Worth Building

This is the first project in the series that requires the server to **push** information to users the instant something happens, instead of the app repeatedly asking "anything new?" It also introduces a permission system with real depth: rules set at the server level, and individual channels that can override those defaults. Getting this right — deciding who can do what, where, and how the app tells everyone in real time — is the whole point.
