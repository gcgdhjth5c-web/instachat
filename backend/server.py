from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import json
import logging
import uuid
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Set

import requests
from fastapi import (
    FastAPI,
    APIRouter,
    HTTPException,
    Request,
    Response,
    Depends,
    WebSocket,
    WebSocketDisconnect,
    Query,
    UploadFile,
    File,
    Header,
)
from fastapi.responses import StreamingResponse
import csv
import io
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, field_validator, EmailStr

# -------------------- Object Storage --------------------
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "instachat"
storage_key: Optional[str] = None


def init_storage() -> Optional[str]:
    global storage_key
    if storage_key:
        return storage_key
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return None
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": key}, timeout=30)
        r.raise_for_status()
        storage_key = r.json()["storage_key"]
        return storage_key
    except Exception as e:
        logging.error(f"storage init failed: {e}")
        return None


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Storage not configured")
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if r.status_code == 403:
        # refresh and retry once
        globals()["storage_key"] = None
        key = init_storage()
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    r.raise_for_status()
    return r.json()


def get_object(path: str) -> tuple:
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Storage not configured")
    r = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    if r.status_code == 403:
        globals()["storage_key"] = None
        key = init_storage()
        r = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


MIME_BY_EXT = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp",
}

# -------------------- Mongo --------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# -------------------- App --------------------
app = FastAPI(title="InstaChat")
api_router = APIRouter(prefix="/api")

JWT_ALGORITHM = "HS256"
JWT_EXP_HOURS = 24 * 7


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


# -------------------- Models --------------------
class RegisterInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=32)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    birthday: str = Field(min_length=1, max_length=40)
    favorite_color: str = Field(min_length=1, max_length=40)
    favorite_number: str = Field(min_length=1, max_length=40)

    @field_validator("username")
    @classmethod
    def username_clean(cls, v: str) -> str:
        v = v.strip().lower()
        if not v.replace("_", "").replace(".", "").isalnum():
            raise ValueError("Username can only contain letters, numbers, underscores, and dots")
        return v

    @field_validator("birthday", "favorite_color", "favorite_number")
    @classmethod
    def normalize_answer(cls, v: str) -> str:
        return v.strip().lower()


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identifier: str  # username or email
    password: str


class ForgotPasswordInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identifier: str  # username or email
    birthday: str = Field(min_length=1, max_length=40)
    favorite_color: str = Field(min_length=1, max_length=40)
    favorite_number: str = Field(min_length=1, max_length=40)
    new_password: str = Field(min_length=6, max_length=128)

    @field_validator("birthday", "favorite_color", "favorite_number")
    @classmethod
    def normalize_answer(cls, v: str) -> str:
        return v.strip().lower()


class MessageInput(BaseModel):
    receiver_id: str
    text: str = Field(default="", max_length=2000)
    image_path: Optional[str] = None
    audio_path: Optional[str] = None
    reply_to: Optional[str] = None

    @field_validator("text")
    @classmethod
    def normalize_text(cls, v: str) -> str:
        return (v or "").strip()


class ReactionInput(BaseModel):
    emoji: str = Field(min_length=1, max_length=12)


# -------------------- Helpers --------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, username: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXP_HOURS),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=JWT_EXP_HOURS * 3600,
        path="/",
    )


def public_user(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "username": doc["username"],
        "email": doc.get("email"),
        "role": doc.get("role", "user"),
        "avatar": doc.get("avatar"),
        "nickname": doc.get("nickname") or None,
        "created_at": doc.get("created_at"),
        "is_banned": bool(doc.get("is_banned", False)),
    }


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("is_banned"):
        raise HTTPException(status_code=403, detail="Account is banned")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def conversation_id_for(user_a: str, user_b: str) -> str:
    return "::".join(sorted([user_a, user_b]))


# -------------------- WebSocket Manager --------------------
class ConnectionManager:
    def __init__(self):
        self.active: Dict[str, Set[WebSocket]] = {}  # user_id -> set of sockets

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.active.setdefault(user_id, set()).add(ws)

    def disconnect(self, user_id: str, ws: WebSocket):
        if user_id in self.active:
            self.active[user_id].discard(ws)
            if not self.active[user_id]:
                del self.active[user_id]

    def is_online(self, user_id: str) -> bool:
        return user_id in self.active and len(self.active[user_id]) > 0

    def online_user_ids(self):
        return list(self.active.keys())

    async def send_to_user(self, user_id: str, payload: dict):
        if user_id not in self.active:
            return
        dead = []
        for ws in list(self.active[user_id]):
            try:
                await ws.send_text(json.dumps(payload, default=str))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)


manager = ConnectionManager()


# -------------------- Auth Routes --------------------
@api_router.get("/")
async def root():
    return {"message": "InstaChat API"}


@api_router.post("/auth/register")
async def register(payload: RegisterInput, response: Response):
    email = payload.email.lower()
    if await db.users.find_one({"username": payload.username}):
        raise HTTPException(status_code=409, detail="Username already taken")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")

    user_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": user_id,
        "username": payload.username,
        "email": email,
        "password_hash": hash_password(payload.password),
        "role": "user",
        "avatar": None,
        "created_at": now_iso,
        "recovery": {
            "birthday_hash": hash_password(payload.birthday),
            "favorite_color_hash": hash_password(payload.favorite_color),
            "favorite_number_hash": hash_password(payload.favorite_number),
        },
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id, payload.username, "user")
    set_auth_cookie(response, token)
    return {"user": public_user(doc), "token": token}


@api_router.post("/auth/login")
async def login(payload: LoginInput, response: Response):
    ident = payload.identifier.strip().lower()
    user = await db.users.find_one({"$or": [{"username": ident}, {"email": ident}]})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("is_banned"):
        raise HTTPException(status_code=403, detail="Account is banned")
    token = create_access_token(user["id"], user["username"], user.get("role", "user"))
    set_auth_cookie(response, token)
    return {"user": public_user(user), "token": token}


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")
    return {"message": "Logged out"}


@api_router.post("/auth/forgot-password")
async def forgot_password(payload: ForgotPasswordInput):
    ident = payload.identifier.strip().lower()
    user = await db.users.find_one({"$or": [{"username": ident}, {"email": ident}]})
    # Always behave identically whether or not the user exists, to avoid leaking
    # which usernames/emails are registered.
    generic_error = HTTPException(
        status_code=401,
        detail="One or more answers are incorrect. Password not reset.",
    )
    if not user:
        raise generic_error
    if user.get("role") == "admin":
        # Admin accounts cannot be self-recovered; admin must be reset by another
        # admin or via direct DB action.
        raise HTTPException(
            status_code=403,
            detail="Admin accounts cannot use self-service password recovery.",
        )
    rec = user.get("recovery") or {}
    required = ("birthday_hash", "favorite_color_hash", "favorite_number_hash")
    if not all(rec.get(k) for k in required):
        raise HTTPException(
            status_code=400,
            detail="This account has no recovery questions on file. Please contact an admin to reset your password.",
        )
    # All three must match. We deliberately check all three (no short-circuit
    # disclosure of which one was wrong).
    correct_birthday = verify_password(payload.birthday, rec["birthday_hash"])
    correct_color = verify_password(payload.favorite_color, rec["favorite_color_hash"])
    correct_number = verify_password(payload.favorite_number, rec["favorite_number_hash"])
    if not (correct_birthday and correct_color and correct_number):
        raise generic_error
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "password_hash": hash_password(payload.new_password),
            "password_reset_at": datetime.now(timezone.utc).isoformat(),
            "password_reset_by": "self_recovery",
        }},
    )
    logger.info(f"Self-service password reset for user {user['username']!r}")
    return {"message": "Password reset successful. You can now log in."}


@api_router.get("/auth/me")
async def me(current_user: dict = Depends(get_current_user)):
    return public_user(current_user)


class UpdateProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nickname: Optional[str] = Field(default=None, max_length=40)
    avatar: Optional[str] = Field(default=None, max_length=400)


@api_router.patch("/users/me")
async def update_profile(payload: UpdateProfileInput, current_user: dict = Depends(get_current_user)):
    update: dict = {}
    # Use sentinel detection: a field that's literally null in the JSON body
    # means "clear it"; a missing field means "leave it alone".
    raw = payload.model_dump(exclude_unset=True)
    if "nickname" in raw:
        nick = (raw["nickname"] or "").strip()
        update["nickname"] = nick if nick else None
    if "avatar" in raw:
        path = (raw["avatar"] or "").strip() or None
        if path:
            # Only allow paths the user owns (uploaded themselves) to prevent
            # impersonation by pointing at another user's avatar storage path.
            owned = await db.files.find_one(
                {"storage_path": path, "owner_id": current_user["id"], "is_deleted": {"$ne": True}},
                {"_id": 0, "id": 1},
            )
            if not owned:
                raise HTTPException(status_code=400, detail="Avatar must reference a file you uploaded")
        update["avatar"] = path
    if not update:
        return public_user(current_user)
    await db.users.update_one({"id": current_user["id"]}, {"$set": update})
    updated = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "password_hash": 0})
    return public_user(updated)


# -------------------- Users --------------------
@api_router.get("/users/search")
async def search_users(q: str = Query("", min_length=0, max_length=50), current_user: dict = Depends(get_current_user)):
    q = q.strip().lower()
    query: dict = {"id": {"$ne": current_user["id"]}}
    if q:
        query["username"] = {"$regex": f"^{q}", "$options": "i"}
    cursor = db.users.find(query, {"_id": 0, "password_hash": 0}).limit(20)
    users = await cursor.to_list(length=20)
    online = set(manager.online_user_ids())
    return [{**public_user(u), "online": u["id"] in online} for u in users]


@api_router.get("/users/{user_id}")
async def get_user(user_id: str, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {**public_user(user), "online": manager.is_online(user_id)}


# -------------------- Conversations & Messages --------------------
@api_router.get("/conversations")
async def list_conversations(current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    # Get last message per conversation involving this user
    pipeline = [
        {"$match": {"$or": [{"sender_id": uid}, {"receiver_id": uid}]}},
        {"$sort": {"created_at": -1}},
        {
            "$group": {
                "_id": "$conversation_id",
                "last_message": {"$first": "$$ROOT"},
                "unread_count": {
                    "$sum": {
                        "$cond": [
                            {"$and": [{"$eq": ["$receiver_id", uid]}, {"$eq": ["$seen", False]}]},
                            1,
                            0,
                        ]
                    }
                },
            }
        },
        {"$sort": {"last_message.created_at": -1}},
        {"$limit": 100},
    ]
    convos = await db.messages.aggregate(pipeline).to_list(length=100)
    online = set(manager.online_user_ids())
    result = []
    for c in convos:
        last = c["last_message"]
        other_id = last["receiver_id"] if last["sender_id"] == uid else last["sender_id"]
        other = await db.users.find_one({"id": other_id}, {"_id": 0, "password_hash": 0})
        if not other:
            continue
        last.pop("_id", None)
        result.append({
            "conversation_id": c["_id"],
            "other_user": {**public_user(other), "online": other_id in online},
            "last_message": last,
            "unread_count": c["unread_count"],
        })
    return result


@api_router.get("/messages/{other_user_id}")
async def get_messages(other_user_id: str, current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    conv_id = conversation_id_for(uid, other_user_id)
    cursor = db.messages.find({"conversation_id": conv_id}, {"_id": 0}).sort("created_at", 1)
    messages = await cursor.to_list(length=2000)
    # Mark all messages where current user is receiver as seen
    await db.messages.update_many(
        {"conversation_id": conv_id, "receiver_id": uid, "seen": False},
        {"$set": {"seen": True, "seen_at": datetime.now(timezone.utc).isoformat()}},
    )
    # Notify sender about seen
    await manager.send_to_user(other_user_id, {
        "type": "messages_seen",
        "conversation_id": conv_id,
        "seen_by": uid,
    })
    return messages


@api_router.post("/messages")
async def send_message(payload: MessageInput, current_user: dict = Depends(get_current_user)):
    sender_id = current_user["id"]
    if not payload.text and not payload.image_path and not payload.audio_path:
        raise HTTPException(status_code=400, detail="Message text, image, or audio required")
    receiver = await db.users.find_one({"id": payload.receiver_id}, {"_id": 0, "password_hash": 0})
    if not receiver:
        raise HTTPException(status_code=404, detail="Receiver not found")
    if payload.receiver_id == sender_id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")

    reply_snippet = None
    if payload.reply_to:
        parent = await db.messages.find_one({"id": payload.reply_to}, {"_id": 0})
        if parent and parent.get("conversation_id") == conversation_id_for(sender_id, payload.receiver_id):
            reply_snippet = {
                "id": parent["id"],
                "sender_id": parent["sender_id"],
                "text": (parent.get("text") or "")[:120],
                "image_path": parent.get("image_path"),
                "audio_path": parent.get("audio_path"),
            }

    msg_doc = {
        "id": str(uuid.uuid4()),
        "conversation_id": conversation_id_for(sender_id, payload.receiver_id),
        "sender_id": sender_id,
        "receiver_id": payload.receiver_id,
        "text": payload.text or "",
        "image_path": payload.image_path,
        "audio_path": payload.audio_path,
        "reply_to": reply_snippet,
        "reactions": {},
        "created_at": datetime.now(timezone.utc).isoformat(),
        "seen": False,
        "seen_at": None,
    }
    await db.messages.insert_one(msg_doc)
    msg_doc.pop("_id", None)
    payload_ws = {"type": "message", "message": msg_doc}
    await manager.send_to_user(payload.receiver_id, payload_ws)
    await manager.send_to_user(sender_id, payload_ws)
    return msg_doc


@api_router.post("/messages/{message_id}/reactions")
async def toggle_reaction(message_id: str, payload: ReactionInput, current_user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    uid = current_user["id"]
    if uid not in (msg["sender_id"], msg["receiver_id"]):
        raise HTTPException(status_code=403, detail="Not your conversation")
    reactions = msg.get("reactions") or {}
    users = list(reactions.get(payload.emoji, []))
    if uid in users:
        users.remove(uid)
    else:
        users.append(uid)
    if users:
        reactions[payload.emoji] = users
    else:
        reactions.pop(payload.emoji, None)
    await db.messages.update_one({"id": message_id}, {"$set": {"reactions": reactions}})
    update = {
        "type": "reaction",
        "message_id": message_id,
        "conversation_id": msg["conversation_id"],
        "reactions": reactions,
    }
    await manager.send_to_user(msg["sender_id"], update)
    await manager.send_to_user(msg["receiver_id"], update)
    return {"message_id": message_id, "reactions": reactions}


@api_router.patch("/messages/{message_id}")
async def edit_message(message_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    new_text = (payload.get("text") or "").strip()
    if not new_text:
        raise HTTPException(status_code=400, detail="Text required")
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg: raise HTTPException(status_code=404, detail="Not found")
    if msg["sender_id"] != current_user["id"]: raise HTTPException(status_code=403, detail="Not your message")
    if msg.get("is_deleted"): raise HTTPException(status_code=400, detail="Cannot edit deleted message")
    if msg.get("image_path") or msg.get("audio_path"):
        raise HTTPException(status_code=400, detail="Cannot edit media messages")
    await db.messages.update_one({"id": message_id}, {"$set": {"text": new_text, "edited_at": datetime.now(timezone.utc).isoformat()}})
    update = {"type": "message_updated", "message_id": message_id, "text": new_text, "conversation_id": msg["conversation_id"]}
    await manager.send_to_user(msg["sender_id"], update)
    await manager.send_to_user(msg["receiver_id"], update)
    return {"ok": True}


@api_router.delete("/messages/{message_id}")
async def delete_message(message_id: str, current_user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg: raise HTTPException(status_code=404, detail="Not found")
    if msg["sender_id"] != current_user["id"]: raise HTTPException(status_code=403, detail="Not your message")
    await db.messages.update_one({"id": message_id}, {"$set": {"is_deleted": True, "text": "", "image_path": None, "audio_path": None, "deleted_at": datetime.now(timezone.utc).isoformat()}})
    update = {"type": "message_deleted", "message_id": message_id, "conversation_id": msg["conversation_id"]}
    await manager.send_to_user(msg["sender_id"], update)
    await manager.send_to_user(msg["receiver_id"], update)
    return {"ok": True}


@api_router.get("/messages/search/q")
async def search_messages(q: str = Query(..., min_length=1, max_length=100), current_user: dict = Depends(get_current_user)):
    uid = current_user["id"]
    import re as _re
    pattern = _re.escape(q.strip())
    cursor = db.messages.find({
        "$and": [
            {"$or": [{"sender_id": uid}, {"receiver_id": uid}]},
            {"text": {"$regex": pattern, "$options": "i"}},
            {"is_deleted": {"$ne": True}},
        ]
    }, {"_id": 0}).sort("created_at", -1).limit(50)
    return await cursor.to_list(length=50)



# -------------------- File Upload --------------------
@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    ct = file.content_type or ""
    if not (ct.startswith("image/") or ct.startswith("audio/")):
        raise HTTPException(status_code=400, detail="Only image or audio files allowed")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 5MB)")
    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "").lower()
    if not ext:
        ext = "webm" if ct.startswith("audio/") else "png"
    path = f"{APP_NAME}/uploads/{current_user['id']}/{uuid.uuid4()}.{ext}"
    result = put_object(path, data, ct)
    await db.files.insert_one({
        "id": str(uuid.uuid4()),
        "owner_id": current_user["id"],
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": ct,
        "size": result.get("size", len(data)),
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"path": result["path"], "content_type": ct, "size": result.get("size", len(data))}


@api_router.get("/files/{path:path}")
async def serve_file(
    path: str,
    request: Request,
    auth: Optional[str] = Query(None),
):
    # Authenticate via cookie, Authorization header, or ?auth= query param (for <img>).
    token = request.cookies.get("access_token")
    if not token:
        h = request.headers.get("Authorization", "")
        if h.startswith("Bearer "):
            token = h[7:]
    if not token and auth:
        token = auth
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    decode_token(token)  # raises 401 if invalid
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    data, ctype = get_object(path)
    return Response(content=data, media_type=record.get("content_type") or ctype)


# -------------------- Admin --------------------
@api_router.get("/admin/users")
async def admin_list_users(_: dict = Depends(require_admin)):
    cursor = db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1)
    users = await cursor.to_list(length=1000)
    online = set(manager.online_user_ids())
    return [{**public_user(u), "online": u["id"] in online} for u in users]


@api_router.get("/admin/conversations")
async def admin_list_conversations(_: dict = Depends(require_admin)):
    pipeline = [
        {"$sort": {"created_at": -1}},
        {
            "$group": {
                "_id": "$conversation_id",
                "last_message": {"$first": "$$ROOT"},
                "count": {"$sum": 1},
                "user_ids": {"$addToSet": "$sender_id"},
                "receiver_ids": {"$addToSet": "$receiver_id"},
            }
        },
        {"$sort": {"last_message.created_at": -1}},
        {"$limit": 500},
    ]
    convos = await db.messages.aggregate(pipeline).to_list(length=500)
    result = []
    for c in convos:
        last = c["last_message"]
        last.pop("_id", None)
        ids = list(set(c["user_ids"]) | set(c["receiver_ids"]))
        users_docs = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "password_hash": 0}).to_list(length=10)
        result.append({
            "conversation_id": c["_id"],
            "participants": [public_user(u) for u in users_docs],
            "message_count": c["count"],
            "last_message": last,
        })
    return result


@api_router.get("/admin/messages/{conversation_id}")
async def admin_get_conversation(conversation_id: str, _: dict = Depends(require_admin)):
    cursor = db.messages.find({"conversation_id": conversation_id}, {"_id": 0}).sort("created_at", 1)
    messages = await cursor.to_list(length=5000)
    # Determine participants
    participants = []
    if messages:
        ids = list({messages[0]["sender_id"], messages[0]["receiver_id"]})
        users_docs = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "password_hash": 0}).to_list(length=10)
        participants = [public_user(u) for u in users_docs]
    return {"conversation_id": conversation_id, "participants": participants, "messages": messages}


@api_router.get("/admin/stats")
async def admin_stats(_: dict = Depends(require_admin)):
    total_users = await db.users.count_documents({})
    total_messages = await db.messages.count_documents({})
    distinct_convos = await db.messages.distinct("conversation_id")
    return {
        "total_users": total_users,
        "total_messages": total_messages,
        "total_conversations": len(distinct_convos),
        "online_now": len(manager.online_user_ids()),
    }


# -------------------- Admin: Ban / Unban --------------------
async def _set_user_banned(user_id: str, banned: bool, admin: dict) -> dict:
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Cannot ban an admin")
    if target["id"] == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot ban yourself")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"is_banned": banned, "banned_at": datetime.now(timezone.utc).isoformat() if banned else None}},
    )
    if banned:
        # Kick all live websocket sessions for this user.
        for ws in list(manager.active.get(user_id, set())):
            try:
                await ws.close(code=4403)
            except Exception:
                pass
            manager.disconnect(user_id, ws)
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    online = manager.is_online(user_id)
    return {**public_user(updated), "online": online}


@api_router.post("/admin/users/{user_id}/ban")
async def admin_ban_user(user_id: str, admin: dict = Depends(require_admin)):
    return await _set_user_banned(user_id, True, admin)


@api_router.post("/admin/users/{user_id}/unban")
async def admin_unban_user(user_id: str, admin: dict = Depends(require_admin)):
    return await _set_user_banned(user_id, False, admin)


# -------------------- Admin: Permanent delete --------------------
@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete an admin")
    if target["id"] == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    # Boot any live WebSocket sessions for this user before we delete the row.
    for ws in list(manager.active.get(user_id, set())):
        try:
            await ws.close(code=4404)
        except Exception:
            pass
        manager.disconnect(user_id, ws)

    # Cascade: remove every message the user sent or received, mark their files
    # as deleted so /api/files refuses to serve them, then drop the user row
    # itself. Because (username, email) have UNIQUE indexes, removing the row
    # frees the username + email for fresh signups.
    msg_result = await db.messages.delete_many(
        {"$or": [{"sender_id": user_id}, {"receiver_id": user_id}]}
    )
    file_result = await db.files.update_many(
        {"owner_id": user_id}, {"$set": {"is_deleted": True}}
    )
    await db.users.delete_one({"id": user_id})

    logger.info(
        f"Admin {admin['username']!r} permanently deleted user "
        f"{target['username']!r} <{target.get('email')}> — "
        f"{msg_result.deleted_count} messages purged, "
        f"{file_result.modified_count} files revoked"
    )
    return {
        "deleted_user_id": user_id,
        "deleted_username": target["username"],
        "deleted_email": target.get("email"),
        "messages_removed": msg_result.deleted_count,
        "files_revoked": file_result.modified_count,
    }


# -------------------- Admin: Reset Password --------------------
import secrets as _secrets


class ResetPasswordInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    new_password: Optional[str] = Field(default=None, min_length=6, max_length=128)


@api_router.post("/admin/users/{user_id}/reset-password")
async def admin_reset_password(
    user_id: str,
    payload: ResetPasswordInput,
    admin: dict = Depends(require_admin),
):
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Cannot reset an admin's password")
    if target["id"] == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot reset your own password here")
    # Use the provided password, or generate a strong 12-char temporary one.
    new_password = payload.new_password or _secrets.token_urlsafe(9)[:12]
    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "password_hash": hash_password(new_password),
            "password_reset_at": datetime.now(timezone.utc).isoformat(),
            "password_reset_by": admin["id"],
        }},
    )
    logger.info(f"Admin {admin['username']!r} reset password for user {target['username']!r}")
    return {
        "user_id": user_id,
        "username": target["username"],
        "new_password": new_password,
        "generated": payload.new_password is None,
    }


# -------------------- Admin: CSV Export --------------------
def _csv_response(rows: list, headers: list, filename: str) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/admin/users/export")
async def admin_export_users(_: dict = Depends(require_admin)):
    cursor = db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1)
    users = await cursor.to_list(length=10000)
    online = set(manager.online_user_ids())
    rows = [
        [
            u.get("id", ""),
            u.get("username", ""),
            u.get("email", ""),
            u.get("role", "user"),
            "yes" if u.get("is_banned") else "no",
            "yes" if u.get("id") in online else "no",
            u.get("created_at", ""),
        ]
        for u in users
    ]
    return _csv_response(
        rows,
        ["id", "username", "email", "role", "banned", "online", "created_at"],
        "instachat-users.csv",
    )


@api_router.get("/admin/conversations/export")
async def admin_export_conversations(_: dict = Depends(require_admin)):
    pipeline = [
        {"$sort": {"created_at": -1}},
        {
            "$group": {
                "_id": "$conversation_id",
                "last_message": {"$first": "$$ROOT"},
                "first_message": {"$last": "$$ROOT"},
                "count": {"$sum": 1},
                "user_ids": {"$addToSet": "$sender_id"},
                "receiver_ids": {"$addToSet": "$receiver_id"},
            }
        },
        {"$sort": {"last_message.created_at": -1}},
        {"$limit": 10000},
    ]
    convos = await db.messages.aggregate(pipeline).to_list(length=10000)
    # Resolve all participant usernames in one pass.
    all_ids = set()
    for c in convos:
        all_ids.update(c.get("user_ids", []))
        all_ids.update(c.get("receiver_ids", []))
    users_docs = await db.users.find(
        {"id": {"$in": list(all_ids)}}, {"_id": 0, "id": 1, "username": 1}
    ).to_list(length=10000)
    name_by_id = {u["id"]: u["username"] for u in users_docs}
    rows = []
    for c in convos:
        ids = list(set(c.get("user_ids", [])) | set(c.get("receiver_ids", [])))
        participants = " | ".join(sorted(name_by_id.get(i, i) for i in ids))
        last = c.get("last_message", {})
        first = c.get("first_message", {})
        rows.append([
            c["_id"],
            participants,
            c.get("count", 0),
            first.get("created_at", ""),
            last.get("created_at", ""),
            (last.get("text") or "")[:200],
        ])
    return _csv_response(
        rows,
        ["conversation_id", "participants", "message_count", "first_message_at", "last_message_at", "last_message_preview"],
        "instachat-conversations.csv",
    )


@api_router.get("/admin/messages/{conversation_id}/export")
async def admin_export_messages(conversation_id: str, _: dict = Depends(require_admin)):
    cursor = db.messages.find({"conversation_id": conversation_id}, {"_id": 0}).sort("created_at", 1)
    messages = await cursor.to_list(length=50000)
    ids = list({m["sender_id"] for m in messages} | {m["receiver_id"] for m in messages})
    users_docs = await db.users.find(
        {"id": {"$in": ids}}, {"_id": 0, "id": 1, "username": 1}
    ).to_list(length=1000)
    name_by_id = {u["id"]: u["username"] for u in users_docs}
    rows = [
        [
            m.get("id", ""),
            m.get("created_at", ""),
            name_by_id.get(m.get("sender_id"), m.get("sender_id", "")),
            name_by_id.get(m.get("receiver_id"), m.get("receiver_id", "")),
            (m.get("text") or ""),
            "yes" if m.get("image_path") else "no",
            "yes" if m.get("audio_path") else "no",
            "yes" if m.get("is_deleted") else "no",
            "yes" if m.get("seen") else "no",
        ]
        for m in messages
    ]
    safe_name = conversation_id.replace("::", "_")[:80] or "conversation"
    return _csv_response(
        rows,
        ["message_id", "created_at", "sender", "receiver", "text", "has_image", "has_audio", "deleted", "seen"],
        f"instachat-messages-{safe_name}.csv",
    )


# -------------------- WebSocket --------------------
@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        user_id = payload["sub"]
    except Exception:
        await websocket.close(code=4401)
        return

    user = await db.users.find_one({"id": user_id}, {"_id": 0, "is_banned": 1})
    if user is None or user.get("is_banned"):
        await websocket.close(code=4403)
        return

    await manager.connect(user_id, websocket)
    # Broadcast presence to everyone (lightweight)
    await broadcast_presence(user_id, online=True)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except Exception:
                continue
            mtype = data.get("type")
            if mtype == "typing":
                to_user = data.get("to")
                if to_user:
                    await manager.send_to_user(to_user, {
                        "type": "typing",
                        "from": user_id,
                        "is_typing": bool(data.get("is_typing", False)),
                    })
            elif mtype == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user_id, websocket)
        if not manager.is_online(user_id):
            await broadcast_presence(user_id, online=False)


async def broadcast_presence(user_id: str, online: bool):
    payload = {"type": "presence", "user_id": user_id, "online": online}
    for uid in list(manager.active.keys()):
        if uid != user_id:
            await manager.send_to_user(uid, payload)


# -------------------- Startup --------------------
@app.on_event("startup")
async def startup_event():
    await db.users.create_index("username", unique=True)
    await db.users.create_index("email", unique=True)
    await db.messages.create_index([("conversation_id", 1), ("created_at", 1)])
    await db.messages.create_index([("sender_id", 1), ("receiver_id", 1)])
    await db.files.create_index("storage_path")

    # Init object storage (non-fatal if missing key)
    try:
        if init_storage():
            logging.info("Object storage initialized")
    except Exception as e:
        logging.warning(f"Object storage skipped: {e}")

    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "").lower()
    admin_username = os.environ.get("ADMIN_USERNAME", "admin").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    if admin_email and admin_password:
        existing = await db.users.find_one({"email": admin_email})
        if not existing:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "username": admin_username,
                "email": admin_email,
                "password_hash": hash_password(admin_password),
                "role": "admin",
                "avatar": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            logging.info(f"Seeded admin: {admin_email}")
        elif not verify_password(admin_password, existing["password_hash"]) or existing.get("role") != "admin":
            await db.users.update_one(
                {"email": admin_email},
                {"$set": {"password_hash": hash_password(admin_password), "role": "admin"}},
            )
            logging.info(f"Updated admin: {admin_email}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)
