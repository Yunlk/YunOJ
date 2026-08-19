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
