-- 创建/更新报名页视觉示例比赛。
-- 用法：docker compose exec -T postgres psql -U yunoj -d yunoj -v ON_ERROR_STOP=1 -f - < scripts/seed_registration_demo.sql
DO $$
DECLARE
  v_contest_id BIGINT;
BEGIN
  SELECT id INTO v_contest_id FROM contests WHERE title = 'YunOJ 2026 夏日算法公开赛 · 报名示例' ORDER BY id DESC LIMIT 1;
  IF v_contest_id IS NULL THEN
    INSERT INTO contests (title, mode, feedback, score_mode, penalty_minutes, freeze_duration_minutes, rank_keys, start_time, end_time, description, cover_image, visibility, reg_start_time, reg_end_time, submission_limit, registration_mode, max_team_size, allow_team_edit)
    VALUES ('YunOJ 2026 夏日算法公开赛 · 报名示例', 'ACM', 'realtime', 'all_or_nothing', 20, 30, '{}'::text[], now() + interval '2 days', now() + interval '2 days 3 hours', E'## 欢迎报名\n\n这是一场用于体验 YunOJ 报名流程的公开示例赛。\n\n- 报名方式：个人或队伍，队伍最多 3 人\n- 比赛时长：3 小时\n- 赛制：ACM 罚时，实时反馈\n- 题目：A + B Problem\n\n> 正式比赛公告、赛时勘误和出题组通知会在这里发布。', 'contest-covers/registration-demo-hero.jpg', 'public', now() - interval '1 day', now() + interval '5 days', 0, 'both', 3, true)
    RETURNING id INTO v_contest_id;
  ELSE
    UPDATE contests SET mode = 'ACM', feedback = 'realtime', score_mode = 'all_or_nothing', penalty_minutes = 20, freeze_duration_minutes = 30, rank_keys = '{}'::text[], start_time = now() + interval '2 days', end_time = now() + interval '2 days 3 hours', description = E'## 欢迎报名\n\n这是一场用于体验 YunOJ 报名流程的公开示例赛。\n\n- 报名方式：个人或队伍，队伍最多 3 人\n- 比赛时长：3 小时\n- 赛制：ACM 罚时，实时反馈\n- 题目：A + B Problem\n\n> 正式比赛公告、赛时勘误和出题组通知会在这里发布。', cover_image = 'contest-covers/registration-demo-hero.jpg', visibility = 'public', reg_start_time = now() - interval '1 day', reg_end_time = now() + interval '5 days', submission_limit = 0, registration_mode = 'both', max_team_size = 3, allow_team_edit = true WHERE id = v_contest_id;
  END IF;
  INSERT INTO contest_problems (contest_id, problem_id, display_id, sort_order, score, submission_limit, theme_color)
  VALUES (v_contest_id, 1, 'A', 1, 100, NULL, 'purple')
  ON CONFLICT (contest_id, problem_id) DO UPDATE SET display_id = EXCLUDED.display_id, sort_order = EXCLUDED.sort_order, score = EXCLUDED.score, submission_limit = EXCLUDED.submission_limit, theme_color = EXCLUDED.theme_color;
  INSERT INTO contest_announcements (contest_id, author_id, title, content, pinned)
  SELECT v_contest_id, 1, '欢迎报名 · 比赛说明', E'报名通道已经开启，欢迎个人参赛，也可以先报名后邀请队友加入。\n\n比赛开始前可以修改队伍成员和队伍头像。比赛开始后，题目、提交和排行榜会按比赛权限开放。\n\n如发现题面或数据问题，请在比赛答疑区留言。', true
  WHERE NOT EXISTS (SELECT 1 FROM contest_announcements WHERE contest_announcements.contest_id = v_contest_id AND contest_announcements.title = '欢迎报名 · 比赛说明');
  UPDATE contest_announcements
  SET content = E'报名通道已经开启，欢迎个人参赛，也可以先报名后邀请队友加入。\n\n比赛开始前可以修改队伍成员和队伍头像。比赛开始后，题目、提交和排行榜会按比赛权限开放。\n\n如发现题面或数据问题，请在比赛答疑区留言。',
      pinned = true, updated_at = now()
  WHERE contest_announcements.contest_id = v_contest_id
    AND contest_announcements.title = '欢迎报名 · 比赛说明';
  RAISE NOTICE 'registration demo contest id: %', v_contest_id;
END
$$;
