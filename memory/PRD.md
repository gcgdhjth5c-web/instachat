# InstaChat — PRD

## Original Problem Statement
Build a full-stack real-time chat web application with an Instagram-style UI and admin message monitoring system.

## Stack
- **Frontend**: React 19 + Tailwind + sonner + react-router 7 + emoji-picker-react + lucide-react
- **Backend**: FastAPI (Python) + native WebSockets (substituted for Node/Express + Socket.io — environment-locked)
- **Database**: MongoDB
- **Auth**: JWT (HS256, 7d) in httpOnly cookie + localStorage Bearer for WS auth, bcrypt hashing

## User Personas
- **Regular user**: signs up with username + email + password, searches users, opens chats, sends/receives DMs in real time
- **Admin**: seeded on startup; can monitor every conversation in the platform

## Core Requirements (Met ✓)
- Email + username + password auth with secure hashing
- Live user search by username
- Real-time 1:1 messaging via WebSocket
- Instagram-style UI: white/black minimal theme, rounded bubbles, sent=blue gradient right, received=grey left
- Sidebar (profile + recent chats + search) + chat panel
- Admin `/admin` dashboard with stats + all conversations + per-conversation read view
- Typing indicator
- Seen/delivered ticks (single check → double-check blue)
- Online/offline presence dot
- Dark mode toggle (persisted)
- Emoji picker
- Mobile responsive (sidebar/chat toggle on mobile)
- Smooth message-appear animation

## Admin Seed
- Email: `jashanpreetgamer2@gmail.com`
- Password: `Gamerz1234518102008`
- Auto-seeded on backend startup; login from `/login`

## Data Models
- `users` { id, username (unique), email (unique), password_hash, role, avatar, created_at }
- `messages` { id, conversation_id, sender_id, receiver_id, text, created_at, seen, seen_at }
  - `conversation_id` = `sorted(user_a, user_b).join("::")` — guarantees a single thread per pair

## What's Been Implemented (Feb 2026 — Iteration 3)
- **Image attachments**: Emergent object storage integration. `/api/upload` (5MB image-only), `/api/files/{path}` serves with cookie/header/?auth= modes. UI: attach-image button + inline image rendering via ChatImage.
- **Message reactions**: Slack-style. Multiple emojis × multiple users with counts. Hover reveals `+` button → 6-emoji quick popover. Chips toggle your own reaction. Realtime sync via WebSocket `reaction` events.
- **In-tab push notifications**: Native `Notification` API. Permission requested on Chat mount. Fires when a new message arrives outside the active chat or when the tab is hidden.

## What's Been Implemented (Feb 2026 — Iteration 2)
- Full auth flow, user search, real-time DMs, presence, typing, seen ticks, dark mode, emoji
- Admin console with stats, users tab, conversations tab, full message history viewer
- WebSocket reconnect with exponential backoff
- 18 end-to-end tests passed via testing agent

## Backlog
- **P1**: Voice/video calling, image attachments, read receipts list (who & when)
- **P2**: Group chats, message reactions, message edit/delete
- **P2**: Push notifications, email notifications
- **P2**: User profile editing, avatar upload (object storage), bio
- **P2**: Block / report users

## Next Tasks
- (deferred to user feedback)
