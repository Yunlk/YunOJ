"""通过 YunOJ HTTP API 创建演示赛并切换比赛阶段。

这个脚本只调用公开的管理 API，不直接连接数据库。管理员账号可以用参数
传入，也可以使用 YUNOJ_ADMIN_USER / YUNOJ_ADMIN_PASSWORD 环境变量。

示例：
    python scripts/contest_phase_control.py --admin-user admin --admin-password ... \
        --create-demo --phase running
    python scripts/contest_phase_control.py --admin-user admin --admin-password ... \
        --contest-id 114 --phase freeze
    python scripts/contest_phase_control.py --admin-user admin --admin-password ... \
        --contest-id 114 --phase ended

阶段含义：
    upcoming  未开始
    running   进行中，尚未封榜
    freeze    封榜中（封榜时间从当前时刻开始）
    ended     已结束（如果有冻结提交，可打开动态揭晓）

脚本修改的是比赛时间字段。它不会把普通提交伪造为冻结提交；要演示动态
揭晓，请使用 seedcontests 生成的带冻结提交的比赛，或在 freeze 阶段真实提交。
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta
from typing import Any

from contest_control import APIError, Client, login


DEFAULT_TITLE = "[演示] 外部阶段控制 · ACM 封榜"
PHASES = ("upcoming", "running", "freeze", "ended")


def now_local() -> datetime:
    return datetime.now().astimezone().replace(microsecond=0)


def iso_time(value: datetime) -> str:
    return value.astimezone().replace(microsecond=0).isoformat()


def parse_api_time(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.astimezone()
    return parsed


def stage_times(phase: str, now: datetime) -> tuple[datetime, datetime, int]:
    """返回 start、end、freeze_duration_minutes，保证 phase 清晰可见。"""
    if phase == "upcoming":
        return now + timedelta(minutes=10), now + timedelta(minutes=130), 30
    if phase == "running":
        return now - timedelta(minutes=10), now + timedelta(minutes=110), 30
    if phase == "freeze":
        # end - 30 分钟 == now，正好进入封榜，不依赖等待下一分钟。
        return now - timedelta(minutes=60), now + timedelta(minutes=30), 30
    if phase == "ended":
        return now - timedelta(minutes=120), now - timedelta(minutes=1), 30
    raise ValueError(f"未知阶段: {phase}")


def phase_of(contest: dict[str, Any], now: datetime) -> str:
    start = parse_api_time(contest.get("start_time"))
    end = parse_api_time(contest.get("end_time"))
    if start is None or end is None:
        return "unknown"
    if now < start:
        return "upcoming"
    if now >= end:
        return "ended"
    freeze_minutes = int(contest.get("freeze_duration_minutes") or 0)
    freeze_at = end - timedelta(minutes=freeze_minutes) if freeze_minutes > 0 else None
    if freeze_at is not None and now >= freeze_at:
        return "freeze"
    return "running"


def contest_payload(contest: dict[str, Any], start: datetime, end: datetime, freeze_minutes: int) -> dict[str, Any]:
    """将详情接口返回的 contest 转成 PUT 所需的完整 payload。"""
    return {
        "title": str(contest.get("title", "")),
        "mode": str(contest.get("mode", "ACM")),
        "feedback": str(contest.get("feedback", "realtime")),
        "score_mode": str(contest.get("score_mode", "all_or_nothing")),
        "penalty_minutes": int(contest.get("penalty_minutes") or 0),
        "freeze_duration_minutes": freeze_minutes,
        "rank_keys": contest.get("rank_keys") or [],
        "start_time": iso_time(start),
        "end_time": iso_time(end),
        "description": str(contest.get("description", "")),
        "cover_image": str(contest.get("cover_image", "")),
        "visibility": str(contest.get("visibility", "public")),
        "reg_start_time": contest.get("reg_start_time"),
        "reg_end_time": contest.get("reg_end_time"),
        "submission_limit": int(contest.get("submission_limit") or 0),
        "registration_mode": str(contest.get("registration_mode", "both")),
        "max_team_size": int(contest.get("max_team_size") or 1),
        "allow_team_edit": bool(contest.get("allow_team_edit", True)),
    }


def list_contest_by_title(client: Client, title: str) -> dict[str, Any] | None:
    data = client.call("GET", "/contests?page=1&size=100")
    for item in data.get("items", []):
        if item.get("title") == title:
            return item
    return None


def get_contest(client: Client, contest_id: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    data = client.call("GET", f"/contests/{contest_id}")
    return data["contest"], data.get("problems", [])


def create_demo(client: Client, title: str, problem_id: int, phase: str) -> int:
    existing = list_contest_by_title(client, title)
    if existing is not None:
        contest_id = int(existing["id"])
        _, problems = get_contest(client, contest_id)
        if not any(int(p.get("problem_id", -1)) == problem_id for p in problems):
            client.call(
                "POST",
                f"/contests/{contest_id}/problems",
                {
                    "problem_id": problem_id,
                    "display_id": "A",
                    "sort_order": 1,
                    "score": None,
                    "submission_limit": None,
                    "theme_color": "blue",
                },
            )
        print(f"复用已有示例比赛: id={contest_id}")
        return contest_id

    now = now_local()
    start, end, freeze_minutes = stage_times(phase, now)
    created = client.call(
        "POST",
        "/contests",
        {
            "title": title,
            "mode": "ACM",
            "feedback": "realtime",
            "score_mode": "all_or_nothing",
            "penalty_minutes": 20,
            "freeze_duration_minutes": freeze_minutes,
            "rank_keys": [],
            "start_time": iso_time(start),
            "end_time": iso_time(end),
            "description": (
                "## 外部阶段控制演示\n\n"
                "可用 scripts/contest_phase_control.py 切换比赛生命周期，"
                "用于验收实时榜、封榜和动态揭晓。"
            ),
            "cover_image": "",
            "visibility": "public",
            "reg_start_time": None,
            "reg_end_time": None,
            "submission_limit": 0,
            "registration_mode": "both",
            "max_team_size": 3,
            "allow_team_edit": True,
        },
    )
    contest_id = int(created["id"])
    client.call(
        "POST",
        f"/contests/{contest_id}/problems",
        {
            "problem_id": problem_id,
            "display_id": "A",
            "sort_order": 1,
            "score": None,
            "submission_limit": None,
            "theme_color": "blue",
        },
    )
    print(f"创建示例比赛: id={contest_id}")
    return contest_id


def update_phase(client: Client, contest_id: int, phase: str) -> dict[str, Any]:
    contest, _ = get_contest(client, contest_id)
    now = now_local()
    start, end, freeze_minutes = stage_times(phase, now)
    updated = client.call(
        "PUT",
        f"/contests/{contest_id}",
        contest_payload(contest, start, end, freeze_minutes),
    )
    return updated


def run(options: argparse.Namespace) -> None:
    if options.token:
        client = Client(options.base_url, options.token)
    else:
        if not options.admin_user or not options.admin_password:
            raise APIError("请提供 --admin-user/--admin-password，或设置 YUNOJ_ADMIN_USER/YUNOJ_ADMIN_PASSWORD")
        account = login(options.base_url, options.admin_user, options.admin_password)
        client = Client(options.base_url, account.token)

    contest_id = options.contest_id
    if options.create_demo:
        contest_id = create_demo(client, options.title, options.problem_id, options.phase)
    elif contest_id is None:
        raise APIError("请提供 --contest-id，或使用 --create-demo 创建示例比赛")

    if options.phase == "show":
        contest, _ = get_contest(client, contest_id)
        print(f"比赛: {contest['title']} (id={contest_id})")
        print(f"阶段: {phase_of(contest, now_local())}")
        print(f"开始: {contest['start_time']}\n结束: {contest['end_time']}")
        return

    updated = update_phase(client, int(contest_id), options.phase)
    freeze_minutes = int(updated.get("freeze_duration_minutes") or 0)
    end = parse_api_time(updated.get("end_time"))
    freeze_at = end - timedelta(minutes=freeze_minutes) if end and freeze_minutes else None
    print(f"比赛: {updated['title']} (id={updated['id']})")
    print(f"阶段已切换为: {options.phase}")
    print(f"开始: {updated['start_time']}\n封榜: {iso_time(freeze_at) if freeze_at else '未启用'}\n结束: {updated['end_time']}")
    print(f"榜单: http://localhost:5173/contest/{updated['id']}/standings")
    print(f"动态榜: http://localhost:5173/contest/{updated['id']}/standings/dynamic")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="通过 YunOJ 管理 API 控制比赛生命周期")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080/api")
    parser.add_argument("--admin-user", default=os.getenv("YUNOJ_ADMIN_USER"))
    parser.add_argument("--admin-password", default=os.getenv("YUNOJ_ADMIN_PASSWORD"))
    parser.add_argument("--token", default=os.getenv("YUNOJ_ADMIN_TOKEN"), help="已有管理员 JWT，优先于账号密码")
    parser.add_argument("--contest-id", type=int, help="要切换阶段的比赛 ID")
    parser.add_argument("--create-demo", action="store_true", help="创建或复用一场 ACM 封榜示例比赛")
    parser.add_argument("--title", default=DEFAULT_TITLE, help="--create-demo 使用的比赛标题")
    parser.add_argument("--problem-id", type=int, default=1, help="示例比赛加入的题目 ID（默认 1）")
    parser.add_argument("--phase", choices=(*PHASES, "show"), default="show")
    options = parser.parse_args()
    if options.phase == "show" and options.create_demo:
        parser.error("--create-demo 需要同时指定 --phase upcoming/running/freeze/ended")
    if options.phase != "show" and not options.create_demo and options.contest_id is None:
        parser.error("切换阶段需要 --contest-id，或使用 --create-demo")
    return options


if __name__ == "__main__":
    try:
        run(parse_args())
    except (APIError, KeyError, ValueError) as exc:
        print(f"失败: {exc}", file=sys.stderr)
        sys.exit(1)
