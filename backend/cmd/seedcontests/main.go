// 比赛流程演示数据生成器。
//
// 用法：
//
//	go -C backend run ./cmd/seedcontests
//	go -C backend run ./cmd/seedcontests -reset
//	go -C backend run ./cmd/seedcontests -live-freeze-at 16:40
//
// 生成的数据覆盖 ACM、ICPC 滚榜、OI、IOI、练习赛和自定义配置，
// 并额外生成一场首分钟 50 条冻结 AC 提交的滚榜压力演示。
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/yunoj/yunoj/internal/auth"
	"github.com/yunoj/yunoj/internal/config"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

const (
	seedPrefix   = "[演示]"
	demoPassword = "demo123"
	problemID    = int64(1)
)

type contestSpec struct {
	Key            string
	Title          string
	Mode           string
	Feedback       string
	ScoreMode      string
	PenaltyMinutes int
	FreezeMinutes  int
	RankKeys       []string
	Start          time.Time
	End            time.Time
	Description    string
	Registration   string
	MaxTeamSize    int
	RegStart       *time.Time
	RegEnd         *time.Time
}

type demoUser struct {
	ID       int64
	Username string
}

func main() {
	reset := flag.Bool("reset", false, "删除本命令生成的演示比赛后重新生成")
	resetContestID := flag.Int64("reset-contest-id", 0, "只清空指定演示比赛的提交/报名并保留比赛配置")
	liveFreezeAt := flag.String("live-freeze-at", "", "创建一场当天指定时间封榜的实时演示赛（支持 HH:MM 或 RFC3339）")
	flag.Parse()

	ctx := context.Background()
	cfg := config.Load()
	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("连接数据库失败", "err", err)
		os.Exit(1)
	}
	defer st.Close()
	if err := model.Migrate(ctx, st.Pool()); err != nil {
		slog.Error("迁移失败", "err", err)
		os.Exit(1)
	}
	if *resetContestID > 0 {
		if err := resetSingleContest(ctx, st, *resetContestID); err != nil {
			slog.Error("重置比赛失败", "contest_id", *resetContestID, "err", err)
			os.Exit(1)
		}
		cache := make(map[string]demoUser)
		users := ensureUsers(ctx, st, cache, "flow", 12)
		if err := ensureTeams(ctx, st, *resetContestID, users, "流程队伍"); err != nil {
			slog.Error("恢复演示报名失败", "contest_id", *resetContestID, "err", err)
			os.Exit(1)
		}
		fmt.Printf("比赛 %d 已重置：提交已清空，已恢复 flow01..flow12 报名\n", *resetContestID)
		return
	}

	if *reset {
		if _, err := st.Pool().Exec(ctx, `DELETE FROM contests WHERE title LIKE $1`, seedPrefix+" %"); err != nil {
			slog.Error("清理演示比赛失败", "err", err)
			os.Exit(1)
		}
		fmt.Println("已清理本命令生成的演示比赛")
	}

	if _, err := st.GetProblem(ctx, problemID); err != nil {
		slog.Error("找不到模板题 A+B Problem", "problem_id", problemID, "err", err)
		os.Exit(1)
	}

	now := time.Now().Truncate(time.Second)
	users := make(map[string]demoUser)
	standardUsers := ensureUsers(ctx, st, users, "flow", 12)
	burstUsers := ensureUsers(ctx, st, users, "burst", 50)
	if strings.TrimSpace(*liveFreezeAt) != "" {
		freezeAt, err := parseFreezeAt(*liveFreezeAt, now)
		if err != nil {
			slog.Error("解析实时封榜时间失败", "value", *liveFreezeAt, "err", err)
			os.Exit(1)
		}
		spec := buildLiveFreezeSpec(freezeAt)
		c, err := ensureContest(ctx, st, spec)
		if err != nil {
			slog.Error("创建实时封榜演示失败", "err", err)
			os.Exit(1)
		}
		if err := ensureContestProblem(ctx, st, c.ID); err != nil {
			slog.Error("添加实时封榜演示题失败", "contest_id", c.ID, "err", err)
			os.Exit(1)
		}
		if err := seedWorkflowSubmissions(ctx, st, c, standardUsers); err != nil {
			slog.Error("生成实时封榜提交失败", "contest_id", c.ID, "err", err)
			os.Exit(1)
		}
		printContest(c)
		return
	}

	specs := buildSpecs(now)
	for _, spec := range specs {
		c, err := ensureContest(ctx, st, spec)
		if err != nil {
			slog.Error("创建演示比赛失败", "title", spec.Title, "err", err)
			os.Exit(1)
		}
		if err := ensureContestProblem(ctx, st, c.ID); err != nil {
			slog.Error("添加演示题失败", "contest_id", c.ID, "err", err)
			os.Exit(1)
		}
		if err := seedWorkflowSubmissions(ctx, st, c, standardUsers); err != nil {
			slog.Error("生成流程提交失败", "contest_id", c.ID, "err", err)
			os.Exit(1)
		}
		printContest(c)
	}

	burstSpec := buildBurstSpec(now)
	burstContest, err := ensureContest(ctx, st, burstSpec)
	if err != nil {
		slog.Error("创建滚榜压力演示失败", "err", err)
		os.Exit(1)
	}
	if err := ensureContestProblem(ctx, st, burstContest.ID); err != nil {
		slog.Error("添加滚榜演示题失败", "contest_id", burstContest.ID, "err", err)
		os.Exit(1)
	}
	if err := seedBurstSubmissions(ctx, st, burstContest, burstUsers); err != nil {
		slog.Error("生成 50 条滚榜提交失败", "err", err)
		os.Exit(1)
	}
	printContest(burstContest)

	fmt.Printf("\n演示账号密码：%s（flow01..flow12、burst01..burst50）\n", demoPassword)
}

func resetSingleContest(ctx context.Context, st *store.Store, contestID int64) error {
	var title string
	if err := st.Pool().QueryRow(ctx, `SELECT title FROM contests WHERE id = $1`, contestID).Scan(&title); err != nil {
		return fmt.Errorf("比赛不存在: %w", err)
	}
	if !strings.HasPrefix(title, seedPrefix) {
		return fmt.Errorf("拒绝重置非演示比赛 %d (%s)", contestID, title)
	}
	tx, err := st.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM submissions WHERE contest_id = $1`, contestID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM contest_teams WHERE contest_id = $1`, contestID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func buildSpecs(now time.Time) []contestSpec {
	return []contestSpec{
		{
			Key: "acm", Title: seedPrefix + " ACM 标准 · 已结束", Mode: model.ContestModeACM,
			Feedback: model.FeedbackRealtime, ScoreMode: model.ScoreModeAllOrNothing,
			PenaltyMinutes: 20, Start: now.Add(-4 * time.Hour), End: now.Add(-2 * time.Hour),
			Registration: model.ContestRegistrationIndividual, MaxTeamSize: 1,
			Description: "## ACM 标准流程演示\n\n已结束的普通 ACM 比赛。包含 WA、TLE、MLE、CE、RE、PE、OLE、SE 和未运行等提交状态，适合查看提交记录与最终榜单。",
		},
		{
			Key: "control", Title: seedPrefix + " 外部控制 · 实时 ACM", Mode: model.ContestModeACM,
			Feedback: model.FeedbackRealtime, ScoreMode: model.ScoreModeAllOrNothing,
			PenaltyMinutes: 20, Start: now.Add(-15 * time.Minute), End: now.Add(90 * time.Minute),
			Registration: model.ContestRegistrationIndividual, MaxTeamSize: 1,
			Description: "## 外部控制脚本联动测试\n\n比赛正在进行中，预留给 scripts/contest_control.py。脚本通过真实登录、报名和提交接口制造评测事件，普通榜单会随判题结果实时更新。",
		},
		{
			Key: "icpc", Title: seedPrefix + " ICPC 滚榜 · 封榜揭晓", Mode: model.ContestModeACM,
			Feedback: model.FeedbackRealtime, ScoreMode: model.ScoreModeAllOrNothing,
			PenaltyMinutes: 20, FreezeMinutes: 30, Start: now.Add(-3 * time.Hour), End: now.Add(-1 * time.Hour),
			Registration: model.ContestRegistrationBoth, MaxTeamSize: 3,
			Description: "## ICPC 滚榜流程演示\n\n已结束且存在封榜窗口。管理员可从普通榜单进入动态榜单，逐条查看冻结提交如何改变队伍状态。",
		},
		{
			Key: "oi", Title: seedPrefix + " OI 赛制 · 进行中", Mode: model.ContestModeOI,
			Feedback: model.FeedbackRealtime, ScoreMode: model.ScoreModePartial,
			Start: now.Add(-10 * time.Minute), End: now.Add(50 * time.Minute),
			Registration: model.ContestRegistrationIndividual, MaxTeamSize: 1,
			Description: "## OI 赛制流程演示\n\n正在进行中，允许部分分。页面中保留 pending、running 和已完成评测的提交，便于观察实时状态。",
		},
		{
			Key: "ioi", Title: seedPrefix + " IOI 赛制 · 已结束", Mode: model.ContestModeIOI,
			Feedback: model.FeedbackRealtime, ScoreMode: model.ScoreModePartial,
			Start: now.Add(-6 * time.Hour), End: now.Add(-4 * time.Hour),
			Registration: model.ContestRegistrationBoth, MaxTeamSize: 3,
			Description: "## IOI 赛制流程演示\n\n已结束的最优提交计分比赛，同一队伍同一题有多次得分，榜单取各测试点最高分。",
		},
		{
			Key: "practice", Title: seedPrefix + " 练习赛 · 报名中", Mode: model.ContestModeIOI,
			Feedback: model.FeedbackRealtime, ScoreMode: model.ScoreModePartial,
			Start: now.Add(10 * time.Minute), End: now.Add(130 * time.Minute),
			Registration: model.ContestRegistrationBoth, MaxTeamSize: 4,
			RegStart: ptrTime(now.Add(-30 * time.Minute)), RegEnd: ptrTime(now.Add(5 * time.Minute)),
			Description: "## 练习赛流程演示\n\n尚未开始，报名窗口当前开放。适合检查报名、队伍成员管理和比赛开始前的页面状态。",
		},
		{
			Key: "custom", Title: seedPrefix + " 自定义赛制 · 已结束", Mode: model.ContestModeIOI,
			Feedback: model.FeedbackBlind, ScoreMode: model.ScoreModePartial,
			RankKeys: []string{"last_problem_score"}, Start: now.Add(-8 * time.Hour), End: now.Add(-7 * time.Hour),
			Registration: model.ContestRegistrationTeam, MaxTeamSize: 4,
			Description: "## 自定义赛制流程演示\n\n底层使用 IOI 评分引擎，开启盲评并按最后一道题得分作为同分排序键。用于查看自定义选项保存后的实际效果。",
		},
	}
}

func buildBurstSpec(now time.Time) contestSpec {
	start := now.Add(-2 * time.Hour)
	end := now.Add(-1 * time.Hour)
	return contestSpec{
		Key: "burst50", Title: seedPrefix + " 滚榜压力演示 · 首分钟 50 连发", Mode: model.ContestModeACM,
		Feedback: model.FeedbackRealtime, ScoreMode: model.ScoreModeAllOrNothing,
		PenaltyMinutes: 20, FreezeMinutes: 60, Start: start, End: end,
		Registration: model.ContestRegistrationTeam, MaxTeamSize: 3,
		Description: "## 首分钟 50 连发滚榜演示\n\n50 支队伍在比赛第一分钟内各提交一次并全部 AC。提交结果已冻结，比赛结束后打开动态榜单即可逐条播放 50 个排名事件。",
	}
}

func buildLiveFreezeSpec(freezeAt time.Time) contestSpec {
	return contestSpec{
		Key: "livefreeze", Title: seedPrefix + " 实时封榜 · " + freezeAt.Format("01-02 15:04"), Mode: model.ContestModeACM,
		Feedback: model.FeedbackRealtime, ScoreMode: model.ScoreModeAllOrNothing,
		PenaltyMinutes: 20, FreezeMinutes: 60,
		Start: freezeAt.Add(-90 * time.Minute), End: freezeAt.Add(60 * time.Minute),
		Registration: model.ContestRegistrationBoth, MaxTeamSize: 3,
		Description: "## 实时封榜动画演示\n\n封榜时间固定为指定时刻。封榜前榜单实时更新，进入封榜后隐藏新提交，比赛结束后可进入动态榜单逐条揭晓。",
	}
}

func parseFreezeAt(value string, now time.Time) (time.Time, error) {
	value = strings.TrimSpace(value)
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t.Truncate(time.Second), nil
	}
	t, err := time.ParseInLocation("15:04", value, now.Location())
	if err != nil {
		return time.Time{}, fmt.Errorf("请输入 HH:MM 或 RFC3339 时间")
	}
	return time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), 0, 0, now.Location()), nil
}

func ensureContest(ctx context.Context, st *store.Store, spec contestSpec) (model.Contest, error) {
	var c model.Contest
	err := st.Pool().QueryRow(ctx,
		`SELECT id FROM contests WHERE title = $1 ORDER BY id DESC LIMIT 1`, spec.Title).Scan(&c.ID)
	if err == nil {
		return st.GetContest(ctx, c.ID)
	}
	c = model.Contest{
		Title: spec.Title, Mode: spec.Mode, Feedback: spec.Feedback, ScoreMode: spec.ScoreMode,
		PenaltyMinutes: spec.PenaltyMinutes, FreezeDurationMinutes: spec.FreezeMinutes,
		RankKeys: spec.RankKeys, StartTime: spec.Start, EndTime: spec.End,
		Description: spec.Description, Visibility: model.ContestVisibilityPublic,
		RegStartTime: spec.RegStart, RegEndTime: spec.RegEnd,
		RegistrationMode: spec.Registration, MaxTeamSize: spec.MaxTeamSize, AllowTeamEdit: true,
	}
	if c.RankKeys == nil {
		c.RankKeys = []string{}
	}
	if err := st.CreateContest(ctx, &c); err != nil {
		return model.Contest{}, err
	}
	return c, nil
}

func ensureContestProblem(ctx context.Context, st *store.Store, contestID int64) error {
	return st.AddContestProblem(ctx, model.ContestProblem{
		ContestID: contestID, ProblemID: problemID, DisplayID: "A", SortOrder: 1, ThemeColor: "blue",
	})
}

func ensureUsers(ctx context.Context, st *store.Store, cache map[string]demoUser, prefix string, count int) []demoUser {
	hash, err := auth.HashPassword(demoPassword)
	if err != nil {
		slog.Error("生成演示账号密码失败", "err", err)
		os.Exit(1)
	}
	users := make([]demoUser, 0, count)
	for i := 1; i <= count; i++ {
		name := fmt.Sprintf("%s%02d", prefix, i)
		if u, ok := cache[name]; ok {
			users = append(users, u)
			continue
		}
		u, _, lookupErr := st.GetUserByUsername(ctx, name)
		if lookupErr != nil {
			u, lookupErr = st.CreateUser(ctx, name, name+"@demo.local", hash, model.RoleUser)
			if lookupErr != nil {
				slog.Error("创建演示账号失败", "username", name, "err", lookupErr)
				os.Exit(1)
			}
		}
		item := demoUser{ID: u.ID, Username: u.Username}
		cache[name] = item
		users = append(users, item)
	}
	return users
}

func seedWorkflowSubmissions(ctx context.Context, st *store.Store, c model.Contest, users []demoUser) error {
	marker := "// seed:contest-types:" + contestKey(c.Title)
	key := contestKey(c.Title)
	teamPrefix := "流程队伍"
	if key == "livefreeze" {
		teamPrefix = "封榜队伍"
	}
	var count int
	if err := st.Pool().QueryRow(ctx,
		`SELECT count(*) FROM submissions WHERE contest_id = $1 AND code = $2`, c.ID, marker).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return ensureTeams(ctx, st, c.ID, users, teamPrefix)
	}
	if err := ensureTeams(ctx, st, c.ID, users, teamPrefix); err != nil {
		return err
	}
	if key == "control" {
		return nil
	}
	if key == "livefreeze" {
		return seedLiveFreezeSubmissions(ctx, st, c, users)
	}
	base := c.StartTime.Add(2 * time.Minute)
	statuses := []string{
		model.StatusWrongAnswer, model.StatusTimeLimitExceeded, model.StatusMemoryLimitExceeded,
		model.StatusCompileError, model.StatusRuntimeError, model.StatusPresentationError,
		model.StatusOutputLimitExceeded, model.StatusSystemError, model.StatusNotRun,
	}
	for i, status := range statuses {
		if err := insertSubmission(ctx, st, c.ID, users[i].ID, marker, status,
			base.Add(time.Duration(i)*time.Minute), scoreForStatus(status), false); err != nil {
			return err
		}
	}
	// ACM 额外放一条 WA 后 AC，OI/IOI 放多次部分分，方便对比题目状态变化。
	if err := insertSubmission(ctx, st, c.ID, users[9].ID, marker, model.StatusWrongAnswer,
		base.Add(20*time.Minute), 0, false); err != nil {
		return err
	}
	if err := insertSubmission(ctx, st, c.ID, users[9].ID, marker, model.StatusAccepted,
		base.Add(24*time.Minute), 100, false); err != nil {
		return err
	}
	if key == "oi" {
		if err := insertSubmission(ctx, st, c.ID, users[10].ID, marker, model.StatusPending,
			base.Add(25*time.Minute), 0, false); err != nil {
			return err
		}
		if err := insertSubmission(ctx, st, c.ID, users[11].ID, marker, model.StatusRunning,
			base.Add(26*time.Minute), 0, false); err != nil {
			return err
		}
	}
	if key == "ioi" || key == "custom" {
		if err := insertSubmission(ctx, st, c.ID, users[10].ID, marker, model.StatusAccepted,
			base.Add(30*time.Minute), 70, false); err != nil {
			return err
		}
		if err := insertSubmission(ctx, st, c.ID, users[10].ID, marker, model.StatusAccepted,
			base.Add(36*time.Minute), 100, false); err != nil {
			return err
		}
	}
	if key == "icpc" {
		// 封榜窗口内的少量 AC，供普通 ICPC 演示赛直接打开动态榜单。
		freezeAt := c.EndTime.Add(-time.Duration(c.FreezeDurationMinutes) * time.Minute)
		for i := 0; i < 6; i++ {
			at := freezeAt.Add(time.Duration(5+i*4) * time.Minute)
			if err := insertSubmission(ctx, st, c.ID, users[i].ID, marker, model.StatusAccepted,
				at, 100, true); err != nil {
				return err
			}
		}
	}
	return nil
}

func seedLiveFreezeSubmissions(ctx context.Context, st *store.Store, c model.Contest, users []demoUser) error {
	marker := "// seed:contest-types:livefreeze"
	base := c.StartTime.Add(8 * time.Minute)
	// 封榜前先建立可见的基础排名。
	for i := 0; i < 4; i++ {
		if err := insertSubmission(ctx, st, c.ID, users[i].ID, marker, model.StatusAccepted,
			base.Add(time.Duration(i*4)*time.Minute), 100, false); err != nil {
			return err
		}
	}
	for i := 4; i < 7; i++ {
		if err := insertSubmission(ctx, st, c.ID, users[i].ID, marker, model.StatusWrongAnswer,
			base.Add(time.Duration(i*4)*time.Minute), 0, false); err != nil {
			return err
		}
	}

	freezeAt := c.EndTime.Add(-time.Duration(c.FreezeDurationMinutes) * time.Minute)
	// 封榜后混合 WA/AC，动态页会按提交顺序展示每个事件。
	events := []struct {
		user   int
		status string
		offset time.Duration
	}{
		{user: 11, status: model.StatusAccepted, offset: 2 * time.Minute},
		{user: 10, status: model.StatusWrongAnswer, offset: 5 * time.Minute},
		{user: 10, status: model.StatusAccepted, offset: 8 * time.Minute},
		{user: 9, status: model.StatusAccepted, offset: 12 * time.Minute},
		{user: 8, status: model.StatusWrongAnswer, offset: 16 * time.Minute},
		{user: 8, status: model.StatusAccepted, offset: 20 * time.Minute},
		{user: 7, status: model.StatusAccepted, offset: 25 * time.Minute},
	}
	for _, event := range events {
		if err := insertSubmission(ctx, st, c.ID, users[event.user].ID, marker, event.status,
			freezeAt.Add(event.offset), scoreForStatus(event.status), true); err != nil {
			return err
		}
	}
	return nil
}

func seedBurstSubmissions(ctx context.Context, st *store.Store, c model.Contest, users []demoUser) error {
	marker := "// seed:contest-types:burst50"
	var count int
	if err := st.Pool().QueryRow(ctx,
		`SELECT count(*) FROM submissions WHERE contest_id = $1 AND code = $2`, c.ID, marker).Scan(&count); err != nil {
		return err
	}
	if count >= len(users) {
		return ensureTeams(ctx, st, c.ID, users, "连发队伍")
	}
	if err := ensureTeams(ctx, st, c.ID, users, "连发队伍"); err != nil {
		return err
	}
	for i, user := range users {
		// 全部集中在比赛第一分钟，秒数递增只用于确定滚榜播放顺序。
		at := c.StartTime.Add(10 * time.Second).Add(time.Duration(i) * time.Second)
		if err := insertSubmission(ctx, st, c.ID, user.ID, marker, model.StatusAccepted, at, 100, true); err != nil {
			return err
		}
	}
	return nil
}

func ensureTeams(ctx context.Context, st *store.Store, contestID int64, users []demoUser, prefix string) error {
	for i, user := range users {
		if err := st.AddContestTeam(ctx, model.ContestTeam{
			ContestID: contestID, TeamID: user.ID,
			TeamName: fmt.Sprintf("%s %02d", prefix, i+1),
		}); err != nil {
			return err
		}
	}
	return nil
}

func insertSubmission(ctx context.Context, st *store.Store, contestID, userID int64,
	marker, status string, createdAt time.Time, score int, frozen bool) error {
	caseStatus := status
	if status == model.StatusAccepted {
		caseStatus = model.StatusAccepted
	}
	caseScores := fmt.Sprintf("[%d]", score)
	caseResults := fmt.Sprintf(`[{"case_id":1,"status":%q,"time_ms":1,"memory_kb":1400}]`, caseStatus)
	var judgedAt *time.Time
	if model.IsFinal(status) {
		judged := createdAt.Add(time.Second)
		judgedAt = &judged
	}
	_, err := st.Pool().Exec(ctx,
		`INSERT INTO submissions (problem_id, user_id, language, code, status, compile_error,
			case_results, time_ms, memory_kb, score, case_scores, is_frozen, contest_id, created_at, judged_at)
		 VALUES ($1, $2, 'cpp', $3, $4, '', $5::jsonb, 1, 1400, $6, $7::jsonb, $8, $9, $10, $11)`,
		problemID, userID, marker, status, caseResults, score, caseScores, frozen, contestID, createdAt, judgedAt)
	return err
}

func scoreForStatus(status string) int {
	if status == model.StatusAccepted {
		return 100
	}
	return 0
}

func contestKey(title string) string {
	switch {
	case strings.Contains(title, "首分钟 50 连发"):
		return "burst50"
	case strings.Contains(title, "实时封榜"):
		return "livefreeze"
	case strings.Contains(title, "ACM 标准"):
		return "acm"
	case strings.Contains(title, "ICPC 滚榜"):
		return "icpc"
	case strings.Contains(title, "IOI 赛制"):
		return "ioi"
	case strings.Contains(title, "OI 赛制"):
		return "oi"
	case strings.Contains(title, "练习赛"):
		return "practice"
	case strings.Contains(title, "自定义"):
		return "custom"
	default:
		return "icpc"
	}
}

func ptrTime(t time.Time) *time.Time { return &t }

func printContest(c model.Contest) {
	status := "未开始"
	now := time.Now()
	if now.After(c.EndTime) {
		status = "已结束"
	} else if !now.Before(c.StartTime) {
		status = "进行中"
	}
	freeze := ""
	if c.FreezeDurationMinutes > 0 {
		freeze = fmt.Sprintf("，封榜 %d 分钟", c.FreezeDurationMinutes)
	}
	fmt.Printf("%-30s id=%d [%s%s]\n", c.Title, c.ID, status, freeze)
	fmt.Printf("  总览: http://localhost:5173/contest/%d\n", c.ID)
	fmt.Printf("  榜单: http://localhost:5173/contest/%d/standings\n", c.ID)
	if c.Mode == model.ContestModeACM && c.FreezeDurationMinutes > 0 {
		fmt.Printf("  滚榜: http://localhost:5173/contest/%d/standings/dynamic\n", c.ID)
	}
}
