package api

import (
	"testing"
	"time"
)

// TestMarkFirstBlood 一血标记：每题最早通过者唯一；后通过者不标记。
func TestMarkFirstBlood(t *testing.T) {
	t1 := time.Date(2026, 8, 20, 9, 10, 0, 0, time.UTC)
	t2 := t1.Add(5 * time.Minute)

	dtos := []acmStandingDTO{
		{
			TeamID: 1,
			Problems: map[string]acmProblemDTO{
				"A": {Solved: true, SolvedAt: t2.Format(time.RFC3339)}, // 后通过
				"B": {Solved: true, SolvedAt: t1.Format(time.RFC3339)}, // B 题一血
			},
		},
		{
			TeamID: 2,
			Problems: map[string]acmProblemDTO{
				"A": {Solved: true, SolvedAt: t1.Format(time.RFC3339)}, // A 题一血
			},
		},
	}
	markFirstBlood(dtos)

	if dtos[0].Problems["A"].FirstBlood {
		t.Fatal("队伍 1 在 A 题后通过，不应标记一血")
	}
	if !dtos[1].Problems["A"].FirstBlood {
		t.Fatal("队伍 2 应为 A 题一血")
	}
	if !dtos[0].Problems["B"].FirstBlood {
		t.Fatal("队伍 1 应为 B 题一血")
	}
}

// TestMarkFirstBloodTies 同秒通过（理论上罕见）：都标记，避免漏标。
func TestMarkFirstBloodTies(t *testing.T) {
	t1 := time.Date(2026, 8, 20, 9, 10, 0, 0, time.UTC)
	dtos := []acmStandingDTO{
		{TeamID: 1, Problems: map[string]acmProblemDTO{"A": {Solved: true, SolvedAt: t1.Format(time.RFC3339)}}},
		{TeamID: 2, Problems: map[string]acmProblemDTO{"A": {Solved: true, SolvedAt: t1.Format(time.RFC3339)}}},
	}
	markFirstBlood(dtos)
	if !dtos[0].Problems["A"].FirstBlood || !dtos[1].Problems["A"].FirstBlood {
		t.Fatal("同秒通过的两队都应标记一血")
	}
}

// TestMarkFirstBloodEmpty 无通过时不产生标记。
func TestMarkFirstBloodEmpty(t *testing.T) {
	dtos := []acmStandingDTO{
		{TeamID: 1, Problems: map[string]acmProblemDTO{"A": {FailedAttempts: 2}}},
	}
	markFirstBlood(dtos)
	if dtos[0].Problems["A"].FirstBlood {
		t.Fatal("无通过时不应标记一血")
	}
}
