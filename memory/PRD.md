# InstaChat — PRD

## Original Problem Statement (this session)
Cloned from https://github.com/gcgdhjth5c-web/instachat into /app, then iterated with the user on:
1. Admin CSV export + Ban/Unban (initial ask)
2. Receiver-doesn't-see-messages bug (WS rejection regression)
3. Send-delay perceived lag → optimistic UI
4. iOS voice messages not playing on sender → MIME-detection fix
5. Image upload failing → missing `EMERGENT_LLM_KEY` env var
6. Admin viewer not showing images/audio
7. Save-to-gallery on every image
8. Admin password reset (user asked for "see anyone's password" → declined for security; built reset instead)
9. Emergent badge overlaps mobile composer → bottom padding on mobile
10. "Forgot password" self-service via 3 security questions (birthday / favourite color / favourite number)
11. Admin permanent delete with email reuse

## Stack
- **Frontend**: React 19 + Tailwind + sonner + react-router 7 + emoji-picker-react + lucide-react
- **Backend**: FastAPI + native WebSockets
- **Database**: MongoDB
- **Auth**: JWT (HS256, 7d) cookie + localStorage Bearer; bcrypt; security-question self-recovery
- **Storage**: Emergent Object Storage

## User Personas
- **Regular user**: signup with username + email + password + 3 recovery answers; DMs with images / voice / reactions; can save received media to device; can reset own password via recovery questions.
- **Admin**: seeded on startup. Full read access. Can ban/unban, reset password, permanently delete users, export CSVs.

## Core Capabilities (Met ✓)
- Username/email/password + 3-question account recovery
- Real-time 1:1 messaging via WebSocket (presence, typing, seen ticks)
- Optimistic message rendering (instant bubble + 70%-opacity pending state)
- Image attachments + voice notes (5 MB cap, cross-platform MIME)
- Save-to-device on every image (hover overlay + lightbox button)
- Reactions, edit, delete, in-tab notifications
- Dark mode, emoji picker, mobile responsive
- Mobile composer dodges the Emergent badge via `pb-16 md:pb-3` bottom padding
- Sonner toaster moved to bottom-right (was overlapping admin export buttons)

## Admin Capabilities (the heart of this session)
| Surface | Endpoint | Notes |
|---|---|---|
| Stats | `GET /api/admin/stats` | users / convos / messages / online_now |
| Users list | `GET /api/admin/users` | includes `is_banned`, `online` |
| Conversations list | `GET /api/admin/conversations` | last_message + count |
| Conversation viewer | `GET /api/admin/messages/{conv_id}` | now renders images + audio in UI |
| Ban / Unban | `POST /admin/users/{id}/ban` ` /unban` | kicks live WS, blocks login |
| Reset password | `POST /admin/users/{id}/reset-password` | auto-generates strong 12-char, returns once |
| **Permanent delete** | `DELETE /admin/users/{id}` | cascades messages, revokes files, frees email/username |
| CSV: users | `GET /api/admin/users/export` | `id,username,email,role,banned,online,created_at` |
| CSV: conversations | `GET /api/admin/conversations/export` | participants + msg counts + previews |
| CSV: messages | `GET /api/admin/messages/{cid}/export` | per-conversation full transcript |

Admin protections (all return correct HTTP code):
- Cannot ban / delete / reset another admin (400)
- Cannot ban / delete yourself (400)
- Non-admin requests → 403
- Unknown user IDs → 404

## Auth Flow Details
- **Register** (`/register`): username + email + password + birthday + favourite_color + favourite_number (latter three hashed with bcrypt, normalized lowercase+trim).
- **Login** (`/login`): identifier (username OR email) + password. Banned users blocked at 403.
- **Forgot password** (`/forgot-password`): identifier + ALL three recovery answers + new password. All three must match. Generic 401 if any wrong (no leaking which one). Admin accounts blocked (403). Legacy users without answers get an informative 400 telling them to contact admin.
- **Admin reset**: Generates random 12-char password, shown to admin once in a modal with copy-to-clipboard. User must use the new password on next login.
- **Admin delete**: Hard-deletes `users` document, cascades `messages.delete_many({sender_id|receiver_id == user})`, marks `files.is_deleted = true`, closes any live WS with code 4404. After delete, the email and username are immediately re-usable for new signups.

## Data Models (current)
- `users` { id, username (unique), email (unique), password_hash, role, avatar, created_at, is_banned, banned_at, recovery: {birthday_hash, favorite_color_hash, favorite_number_hash}, password_reset_at, password_reset_by }
- `messages` { id, conversation_id, sender_id, receiver_id, text, image_path, audio_path, reply_to, reactions, created_at, seen, seen_at, is_deleted, edited_at, deleted_at }
- `files` { id, owner_id, storage_path, original_filename, content_type, size, is_deleted, created_at }
- `conversation_id` = `sorted(user_a, user_b).join("::")` — single thread per pair.

## Bugs Fixed (Jun 27 — Jun 28, 2026)
1. **WebSocket rejecting every legacy user** — banned-user check used `if not user` on a MongoDB projection result that returned `{}` (falsy) for users without `is_banned` field. Fix: `if user is None`.
2. **Sluggish send** — added optimistic message append with `_pending: true`, reconciled by either HTTP response or WS echo. Removed wasteful full re-fetch on incoming messages.
3. **iOS voice notes silent on sender** — recorder hardcoded `audio/webm`. Now probes `MediaRecorder.isTypeSupported()` and uses the real MIME (mp4 on iOS, webm on Chrome/Android) for both the blob and the file extension.
4. **Image/voice uploads failing** — `.env` missing `EMERGENT_LLM_KEY` so storage init failed silently. Added it.
5. **Admin viewer empty for media messages** — only rendered `m.text`. Now also renders `<ChatImage>` and `<AudioBubble>`, plus mounts the `<Lightbox>` overlay.
6. **Mobile badge overlap** — added `pb-16 md:pb-3` to the composer container so the input row floats above where the Emergent badge sits on mobile.
7. **Toaster overlap with admin CSV buttons** — moved `<Toaster position="bottom-right" />` from top-right.

## Test Results Snapshot (Jun 28, 2026)
- 14/14 pytest for ban + CSV (iteration_5 report)
- Forgot-password: 8/8 manual cases (correct, wrong, ghost user, admin blocked, legacy user, case-insensitive normalize)
- Admin delete: 9/9 manual cases (cascade verified, email re-usable after delete, admin/self/unknown/non-admin guards)
- Admin reset: 6/6 manual cases
- WS realtime delivery: ✅ (verified end-to-end with Python `websockets` client)

## Backlog
- **P1**: Voice/video calling, read receipts list
- **P2**: Group chats, message edit history, push notifications outside the tab
- **P2**: Email-based password reset (Resend integration was paused for this session; API key is in user's possession)
- **P2**: Avatar upload, bio
- **P2**: Audit log of admin actions (who banned/deleted whom & when)
- **P2**: Refactor `server.py` (>1100 lines) into `routers/{auth,messages,admin}.py`
- **P3**: Bulk admin ops (multi-select ban/delete/reset), filterable CSV exports (date range / banned-only)

## Next Tasks
- Awaiting user direction. Resend email integration is the next obvious upgrade if they want to remove the "contact admin" fallback for legacy / forgot-answer users.
