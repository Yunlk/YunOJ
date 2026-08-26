package api

import (
	"testing"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

func TestBlindResultsActive(t *testing.T) {
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
	contest := model.Contest{Feedback: model.FeedbackBlind, EndTime: now.Add(time.Hour)}
	if !blindResultsActive(contest, false, now) {
		t.Fatal("盲评结束前应对普通用户隐藏结果")
	}
	if blindResultsActive(contest, true, now) {
		t.Fatal("管理员不应被盲评脱敏")
	}
	contest.EndTime = now
	if blindResultsActive(contest, false, now) {
		t.Fatal("比赛结束后应公开结果")
	}
}

func TestRedactBlindSubmission(t *testing.T) {
	item := submissionListItem{
		Status: model.StatusAccepted,
		TimeMs: 12, MemoryKb: 2048, Score: 100,
	}
	redactBlindSubmissionListItem(&item)
	if item.Status != "hidden" || item.TimeMs != 0 || item.MemoryKb != 0 || item.Score != 0 {
		t.Fatalf("列表脱敏不完整: %#v", item)
	}

	compileError := "error"
	cases := []model.CaseResult{{CaseID: 1, Status: model.StatusWrongAnswer}}
	scores := []int{0}
	detail := submissionDetail{
		Status: model.StatusWrongAnswer,
		TimeMs: 8, MemoryKb: 1024, Score: 20,
		CompileError: &compileError, CaseResults: &cases, CaseScores: &scores,
	}
	redactBlindSubmissionDetail(&detail)
	if detail.Status != "hidden" || detail.TimeMs != 0 || detail.MemoryKb != 0 || detail.Score != 0 ||
		detail.CompileError != nil || detail.CaseResults != nil || detail.CaseScores != nil {
		t.Fatalf("详情脱敏不完整: %#v", detail)
	}

	pending := submissionListItem{Status: model.StatusRunning, TimeMs: 1}
	redactBlindSubmissionListItem(&pending)
	if pending.Status != model.StatusRunning || pending.TimeMs != 1 {
		t.Fatalf("评测中的状态不应被当作最终结果脱敏: %#v", pending)
	}
}
