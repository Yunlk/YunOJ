package api

import (
	"testing"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

func TestDynamicBoardStartAt(t *testing.T) {
	start := time.Date(2026, 8, 28, 9, 0, 0, 0, time.UTC)
	end := start.Add(50 * time.Minute)

	tests := []struct {
		name string
		c    model.Contest
		want time.Time
	}{
		{
			name: "默认按比赛时长的 20%",
			c:    model.Contest{StartTime: start, EndTime: end},
			want: start.Add(10 * time.Minute),
		},
		{
			name: "显式配置分钟数",
			c:    model.Contest{StartTime: start, EndTime: end, DynamicDelayMinutes: 7},
			want: start.Add(7 * time.Minute),
		},
		{
			name: "短比赛仍按比例计算",
			c:    model.Contest{StartTime: start, EndTime: start.Add(5 * time.Minute)},
			want: start.Add(1 * time.Minute),
		},
		{
			name: "延迟不超过比赛结束",
			c:    model.Contest{StartTime: start, EndTime: start.Add(5 * time.Minute), DynamicDelayMinutes: 60},
			want: start.Add(5 * time.Minute),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := dynamicBoardStartAt(tt.c); !got.Equal(tt.want) {
				t.Fatalf("动态大屏开启时间 = %v，期望 %v", got, tt.want)
			}
		})
	}
}

func TestDynamicLiveSubmissionsIsolatedFromFixedBoard(t *testing.T) {
	start := time.Date(2026, 8, 28, 9, 0, 0, 0, time.UTC)
	openAt := start.Add(10 * time.Minute)
	subs := []model.Submission{
		{ID: 1, CreatedAt: start.Add(5 * time.Minute)},
		{ID: 2, CreatedAt: openAt},
		{ID: 3, CreatedAt: start.Add(12 * time.Minute)},
	}

	fixed := dynamicLiveSubmissions(subs, false, false, openAt)
	if len(fixed) != len(subs) {
		t.Fatalf("固定榜单提交数 = %d，期望 %d", len(fixed), len(subs))
	}
	locked := dynamicLiveSubmissions(subs, true, true, openAt)
	if len(locked) != 0 {
		t.Fatalf("大屏开启前不应返回提交，实际 %d 条", len(locked))
	}
	open := dynamicLiveSubmissions(subs, true, false, openAt)
	if len(open) != 2 || open[0].ID != 2 || open[1].ID != 3 {
		t.Fatalf("大屏开启后提交筛选错误：%v", open)
	}
	// 过滤不能修改固定榜单所持有的切片。
	if len(subs) != 3 || subs[0].ID != 1 {
		t.Fatal("动态筛选修改了原始提交切片")
	}
}
