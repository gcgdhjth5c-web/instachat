"""Backend tests for admin ban/unban and CSV export features."""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to read frontend/.env directly
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

API = f"{BASE_URL}/api"

ADMIN_IDENT = "jashanpreetgamer2@gmail.com"
ADMIN_PASS = "Gamerz1234518102008"


# -------------------- Fixtures --------------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"identifier": ADMIN_IDENT, "password": ADMIN_PASS})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["user"]["role"] == "admin"
    assert data["user"]["is_banned"] is False
    return data["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def _register(suffix: str):
    uniq = uuid.uuid4().hex[:8]
    username = f"test_{suffix}_{uniq}"
    email = f"test_{suffix}_{uniq}@test.com"
    password = "Passw0rd!23"
    r = requests.post(
        f"{API}/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert r.status_code == 200, f"register failed {r.status_code}: {r.text}"
    d = r.json()
    return {"id": d["user"]["id"], "username": username, "email": email,
            "password": password, "token": d["token"]}


@pytest.fixture(scope="session")
def alice():
    return _register("alice")


@pytest.fixture(scope="session")
def bob():
    return _register("bob")


# -------------------- Admin auth & users --------------------
class TestAdminAuth:
    def test_admin_login_returns_token_and_user(self, admin_token):
        assert isinstance(admin_token, str) and len(admin_token) > 10

    def test_admin_users_includes_is_banned(self, admin_headers):
        r = requests.get(f"{API}/admin/users", headers=admin_headers)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) >= 1
        for u in users:
            assert "is_banned" in u, f"is_banned missing on user {u}"
            assert isinstance(u["is_banned"], bool)


# -------------------- Ban / Unban --------------------
class TestBanUnban:
    def test_ban_then_login_blocked(self, admin_headers, alice):
        r = requests.post(f"{API}/admin/users/{alice['id']}/ban", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_banned"] is True
        assert body["id"] == alice["id"]

        # Banned user cannot login
        login = requests.post(
            f"{API}/auth/login",
            json={"identifier": alice["email"], "password": alice["password"]},
        )
        assert login.status_code == 403
        assert "banned" in login.json().get("detail", "").lower()

        # Existing token to /auth/me is rejected with 403
        me = requests.get(
            f"{API}/auth/me",
            headers={"Authorization": f"Bearer {alice['token']}"},
        )
        assert me.status_code == 403
        assert "banned" in me.json().get("detail", "").lower()

    def test_unban_restores_access(self, admin_headers, alice):
        r = requests.post(f"{API}/admin/users/{alice['id']}/unban", headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["is_banned"] is False

        login = requests.post(
            f"{API}/auth/login",
            json={"identifier": alice["email"], "password": alice["password"]},
        )
        assert login.status_code == 200
        # Refresh alice's token for downstream tests
        alice["token"] = login.json()["token"]

    def test_cannot_ban_admin(self, admin_headers):
        r = requests.get(f"{API}/admin/users", headers=admin_headers)
        admins = [u for u in r.json() if u.get("role") == "admin"]
        assert admins, "no admin found in users list"
        admin_id = admins[0]["id"]
        ban = requests.post(f"{API}/admin/users/{admin_id}/ban", headers=admin_headers)
        assert ban.status_code == 400
        assert "admin" in ban.json().get("detail", "").lower()

    def test_non_admin_cannot_ban(self, alice, bob):
        r = requests.post(
            f"{API}/admin/users/{bob['id']}/ban",
            headers={"Authorization": f"Bearer {alice['token']}"},
        )
        assert r.status_code == 403
        assert "admin" in r.json().get("detail", "").lower()

    def test_ban_non_existent_user(self, admin_headers):
        r = requests.post(
            f"{API}/admin/users/{uuid.uuid4()}/ban", headers=admin_headers
        )
        assert r.status_code == 404


# -------------------- Conversation seed for export --------------------
@pytest.fixture(scope="session")
def seeded_conversation(alice, bob):
    # alice sends a message to bob
    r = requests.post(
        f"{API}/messages",
        headers={"Authorization": f"Bearer {alice['token']}"},
        json={"receiver_id": bob["id"], "text": "hello bob, this is alice"},
    )
    assert r.status_code in (200, 201), f"send message failed: {r.status_code} {r.text}"
    msg = r.json()
    return {"conversation_id": msg["conversation_id"], "text": "hello bob, this is alice"}


# -------------------- CSV Exports --------------------
class TestCsvExports:
    def test_users_export_csv(self, admin_headers):
        r = requests.get(f"{API}/admin/users/export", headers=admin_headers)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/csv")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        lines = r.text.strip().splitlines()
        assert lines[0] == "id,username,email,role,banned,online,created_at"
        assert len(lines) >= 2
        # admin row should be present
        assert any("admin" in line.lower() for line in lines[1:])

    def test_conversations_export_csv(self, admin_headers, seeded_conversation):
        r = requests.get(f"{API}/admin/conversations/export", headers=admin_headers)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/csv")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        lines = r.text.strip().splitlines()
        assert lines[0] == ("conversation_id,participants,message_count,"
                            "first_message_at,last_message_at,last_message_preview")
        assert len(lines) >= 2
        assert any(seeded_conversation["conversation_id"] in line for line in lines)

    def test_messages_export_csv(self, admin_headers, seeded_conversation):
        cid = seeded_conversation["conversation_id"]
        r = requests.get(f"{API}/admin/messages/{cid}/export", headers=admin_headers)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/csv")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        lines = r.text.strip().splitlines()
        assert lines[0] == ("message_id,created_at,sender,receiver,text,"
                            "has_image,has_audio,deleted,seen")
        assert any("hello bob, this is alice" in line for line in lines[1:])

    def test_exports_require_auth(self, alice):
        for path in [
            "/admin/users/export",
            "/admin/conversations/export",
            "/admin/messages/foo/export",
        ]:
            # No token → 401 / 403 (Not authenticated)
            r1 = requests.get(f"{API}{path}")
            assert r1.status_code in (401, 403), f"{path} no-auth got {r1.status_code}"
            if r1.status_code == 401:
                assert "auth" in r1.json().get("detail", "").lower() or \
                       "not authenticated" in r1.json().get("detail", "").lower()
            # Non-admin → 403
            r2 = requests.get(
                f"{API}{path}",
                headers={"Authorization": f"Bearer {alice['token']}"},
            )
            assert r2.status_code == 403, f"{path} non-admin got {r2.status_code}"


# -------------------- Regression --------------------
class TestRegression:
    def test_admin_stats(self, admin_headers):
        r = requests.get(f"{API}/admin/stats", headers=admin_headers)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_users", "total_messages", "total_conversations", "online_now"):
            assert k in d

    def test_admin_conversations(self, admin_headers, seeded_conversation):
        r = requests.get(f"{API}/admin/conversations", headers=admin_headers)
        assert r.status_code == 200
        convos = r.json()
        assert isinstance(convos, list)
        assert any(c["conversation_id"] == seeded_conversation["conversation_id"] for c in convos)

    def test_admin_conversation_detail(self, admin_headers, seeded_conversation):
        cid = seeded_conversation["conversation_id"]
        r = requests.get(f"{API}/admin/messages/{cid}", headers=admin_headers)
        assert r.status_code == 200
        d = r.json()
        assert d["conversation_id"] == cid
        assert any("hello bob" in (m.get("text") or "") for m in d["messages"])
