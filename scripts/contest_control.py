"""Drive a YunOJ contest through its HTTP API, without opening the web UI.

Examples:
    python scripts/contest_control.py
    python scripts/contest_control.py --mode wa-then-ac --poll-seconds 45
    python scripts/contest_control.py --contest-id 123 --users flow01,flow02

The default contest is created by cmd/seedcontests and is discovered by title.
It must be an active ACM contest. A running judge is required for submissions
to leave the pending state and update the standings.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import time
from dataclasses import dataclass
from typing import Any
from urllib import error, request


DEFAULT_TITLE = "[演示] 外部控制 · 实时 ACM"
DEFAULT_USERS = [f"flow{i:02d}" for i in range(1, 13)]
AC_CODE = """#include <bits/stdc++.h>
using namespace std;
int main() {
    long long a, b;
    if (cin >> a >> b) cout << a + b << '\\n';
    return 0;
}
"""
WA_CODE = """#include <bits/stdc++.h>
using namespace std;
int main() {
    long long a, b;
    if (cin >> a >> b) cout << a - b << '\\n';
    return 0;
}
"""


@dataclass
class Account:
    username: str
    token: str
    user_id: int
    base_url: str


class APIError(RuntimeError):
    pass


class Client:
    def __init__(self, base_url: str, token: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def call(self, method: str, path: str, body: Any = None) -> Any:
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        req = request.Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            with request.urlopen(req, timeout=15) as response:
                raw = response.read()
        except error.HTTPError as exc:
            raw = exc.read()
            try:
                detail = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                detail = raw.decode("utf-8", errors="replace")
            raise APIError(f"HTTP {exc.code} {method} {path}: {detail}") from exc
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise APIError(f"接口返回了非 JSON 内容: {method} {path}") from exc


def login(base_url: str, username: str, password: str) -> Account:
    data = Client(base_url).call("POST", "/auth/login", {"username": username, "password": password})
    return Account(username, data["token"], int(data["user"]["id"]), base_url)


def discover_contest(client: Client, title: str) -> dict[str, Any]:
    data = client.call("GET", "/contests?page=1&size=100")
    for contest in data.get("items", []):
        if contest.get("title") == title:
            return contest
    raise APIError(f"找不到比赛 {title!r}，请先运行 go run ./cmd/seedcontests")


def register(account: Account, contest_id: int) -> None:
    try:
        Client(account.base_url, account.token).call(
            "POST", f"/contests/{contest_id}/register", {"team_name": f"外部控制 {account.username}"}
        )
    except APIError as exc:
        # 已报名是幂等成功；其它错误必须暴露出来。
        if "HTTP 409" not in str(exc):
            raise


def submit(account: Account, contest_id: int, problem_id: int, code: str) -> tuple[str, int]:
    data = Client(account.base_url, account.token).call(
        "POST",
        f"/contests/{contest_id}/submit",
        {"problem_id": problem_id, "language": "cpp", "code": code, "optimize": True},
    )
    return account.username, int(data["id"])


def submission_status(account: Account, submission_id: int) -> str:
    data = Client(account.base_url, account.token).call("GET", f"/submissions/{submission_id}")
    return str(data.get("status", "unknown"))


def status_label(status: str) -> str:
    return {
        "pending": "排队中",
        "running": "评测中",
        "accepted": "AC",
        "wrong_answer": "WA",
        "time_limit_exceeded": "TLE",
        "memory_limit_exceeded": "MLE",
        "compile_error": "CE",
        "runtime_error": "RE",
    }.get(status, status)


def standings_signature(data: dict[str, Any], account_ids: set[int]) -> tuple[Any, ...]:
    rows = []
    for row in data.get("standings", []):
        if int(row.get("team_id", -1)) not in account_ids:
            continue
        problem = row.get("problems", {}).get("A", {})
        rows.append((row.get("team_id"), row.get("rank"), row.get("solved"), problem.get("last_status")))
    return tuple(rows)


def print_standings(data: dict[str, Any], account_ids: set[int]) -> None:
    rows = []
    for row in data.get("standings", []):
        if int(row.get("team_id", -1)) not in account_ids:
            continue
        problem = row.get("problems", {}).get("A", {})
        rows.append(
            f"#{row.get('rank', '?')} {row.get('team_name', '?')} "
            f"solved={row.get('solved', 0)} A={status_label(problem.get('last_status', 'untried'))}"
        )
    print("榜单: " + " | ".join(rows))


def poll(client: Client, contest_id: int, accounts: list[Account], submission_ids: dict[str, int], seconds: int) -> None:
    account_ids = {account.user_id for account in accounts}
    known_status: dict[str, str] = {}
    last_signature: tuple[Any, ...] | None = None
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        all_final = True
        for account in accounts:
            sid = submission_ids.get(account.username)
            if sid is None:
                continue
            try:
                status = submission_status(account, sid)
            except APIError as exc:
                print(f"提交 #{sid} 查询失败: {exc}")
                continue
            if known_status.get(account.username) != status:
                print(f"{account.username} 提交 #{sid}: {status_label(status)}")
                known_status[account.username] = status
            if status in {"pending", "running"}:
                all_final = False

        data = client.call("GET", f"/contests/{contest_id}/standings")
        signature = standings_signature(data, account_ids)
        if signature != last_signature:
            print_standings(data, account_ids)
            last_signature = signature
        if all_final and submission_ids and all(name in known_status for name in submission_ids):
            return
        time.sleep(1)
    print("轮询结束；如果状态仍是 pending，请启动 judge 后再次运行脚本。")


def run(options: argparse.Namespace) -> None:
    root = Client(options.base_url)
    contest = (
        root.call("GET", f"/contests/{options.contest_id}")["contest"]
        if options.contest_id
        else discover_contest(root, options.contest_title)
    )
    contest_id = int(contest["id"])
    options.contest_id = contest_id
    detail = root.call("GET", f"/contests/{contest_id}")
    problems = detail.get("problems", [])
    if not problems:
        raise APIError("比赛没有题目")
    problem_id = options.problem_id or int(problems[0]["problem_id"])
    print(f"比赛: {contest['title']} (id={contest_id}), 题目 A={problem_id}")

    accounts: list[Account] = []
    for username in options.users:
        account = login(options.base_url, username, options.password)
        accounts.append(account)
    for account in accounts:
        register(account, contest_id)
    print(f"已登录并确认报名: {', '.join(account.username for account in accounts)}")

    def send(code: str) -> dict[str, int]:
        result: dict[str, int] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(accounts)) as pool:
            futures = [pool.submit(submit, account, contest_id, problem_id, code) for account in accounts]
            for future in concurrent.futures.as_completed(futures):
                username, submission_id = future.result()
                result[username] = submission_id
                print(f"{username} -> 提交 #{submission_id}")
        return result

    if options.mode == "wa-then-ac":
        print("第一波：并发提交错误答案，榜单不应增加解题数。")
        first_ids = send(WA_CODE)
        first_started = time.monotonic()
        poll(root, contest_id, accounts, first_ids, min(5, max(1, options.cooldown - 1)))
        remaining = options.cooldown - int(time.monotonic() - first_started)
        if remaining > 0:
            print(f"等待 {remaining} 秒，避开每用户 10 秒提交限流……")
            time.sleep(remaining)
        print("第二波：并发提交正确答案，评测 AC 后榜单才应更新。")
    submission_ids = send(AC_CODE)
    poll(root, contest_id, accounts, submission_ids, options.poll_seconds)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="通过 YunOJ HTTP API 驱动比赛提交并观察榜单")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080/api")
    parser.add_argument("--contest-id", type=int, help="目标比赛 ID；省略时按标题查找")
    parser.add_argument("--contest-title", default=DEFAULT_TITLE)
    parser.add_argument("--problem-id", type=int, help="目标题目 ID；省略时使用比赛第一题")
    parser.add_argument("--users", default=",".join(DEFAULT_USERS), help="逗号分隔的已有账号")
    parser.add_argument("--user-prefix", help="按编号生成账号，例如 burst01..burst50")
    parser.add_argument("--count", type=int, default=12, help="配合 --user-prefix 使用的账号数量")
    parser.add_argument("--password", default="demo123")
    parser.add_argument("--mode", choices=("ac", "wa-then-ac"), default="ac")
    parser.add_argument("--cooldown", type=int, default=11)
    parser.add_argument("--poll-seconds", type=int, default=45)
    options = parser.parse_args()
    if options.user_prefix:
        if options.count < 1 or options.count > 200:
            parser.error("--count 需在 1-200 之间")
        options.users = [f"{options.user_prefix}{i:02d}" for i in range(1, options.count + 1)]
    else:
        options.users = [item.strip() for item in options.users.split(",") if item.strip()]
    if not options.users:
        parser.error("至少需要一个账号")
    return options


if __name__ == "__main__":
    try:
        run(parse_args())
    except (APIError, KeyError, ValueError) as exc:
        print(f"失败: {exc}", file=sys.stderr)
        sys.exit(1)
