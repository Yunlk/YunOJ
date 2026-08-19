package api

import (
	"testing"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

// TestContestSubmitWindowError 验证提交时间窗为 [start_time, end_time)：
// start 整点可提交，end 整点起拒绝。
func TestContestSubmitWindowError(t *testing.T) {
	start := time.Date(2026, 8, 20, 9, 0, 0, 0, time.UTC)
	end := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)
	c := model.Contest{StartTime: start, EndTime: end}

	cases := []struct {
		name string
		now  time.Time
		want string
	}{
		{"开始前 1ns", start.Add(-time.Nanosecond), "比赛尚未开始"},
		{"开始前 1s", start.Add(-time.Second), "比赛尚未开始"},
		{"开始整点（可提交）", start, ""},
		{"进行中", start.Add(time.Hour), ""},
		{"结束前 1ns（可提交）", end.Add(-time.Nanosecond), ""},
		{"结束整点（拒绝）", end, "比赛已结束"},
		{"结束后 1s", end.Add(time.Second), "比赛已结束"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := contestSubmitWindowError(c, tc.now); got != tc.want {
				t.Fatalf("期望 %q，实际 %q", tc.want, got)
			}
		})
	}
}

// TestContestSubmitWindowErrorEmpty 起止时间相同（零长度比赛）全程拒绝。
func TestContestSubmitWindowErrorEmpty(t *testing.T) {
	ts := time.Date(2026, 8, 20, 9, 0, 0, 0, time.UTC)
	c := model.Contest{StartTime: ts, EndTime: ts}
	if got := contestSubmitWindowError(c, ts); got != "比赛已结束" {
		t.Fatalf("零长度比赛应视为已结束，实际 %q", got)
	}
}

// TestContestRegWindowError 报名时间窗：未配置时随比赛时间窗，配置后独立生效。
func TestContestRegWindowError(t *testing.T) {
	start := time.Date(2026, 8, 20, 9, 0, 0, 0, time.UTC)
	end := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)
	regStart := time.Date(2026, 8, 19, 9, 0, 0, 0, time.UTC)
	regEnd := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)

	cases := []struct {
		name string
		c    model.Contest
		now  time.Time
		want string
	}{
		{"默认窗：开始前", model.Contest{StartTime: start, EndTime: end}, start.Add(-time.Second), "报名尚未开始"},
		{"默认窗：开始整点可报", model.Contest{StartTime: start, EndTime: end}, start, ""},
		{"默认窗：结束整点截止", model.Contest{StartTime: start, EndTime: end}, end, "报名已截止"},
		{"独立窗：早于比赛开始", model.Contest{StartTime: start, EndTime: end,
			RegStartTime: &regStart, RegEndTime: &regEnd}, regStart, ""},
		{"独立窗：窗内可报（比赛已开始）", model.Contest{StartTime: start, EndTime: end,
			RegStartTime: &regStart, RegEndTime: &regEnd}, regEnd.Add(-time.Nanosecond), ""},
		{"独立窗：截止后不可报", model.Contest{StartTime: start, EndTime: end,
			RegStartTime: &regStart, RegEndTime: &regEnd}, regEnd, "报名已截止"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := contestRegWindowError(tc.c, tc.now); got != tc.want {
				t.Fatalf("期望 %q，实际 %q", tc.want, got)
			}
		})
	}
}
