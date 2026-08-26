package model

import "time"

// RankingEntry 全站训练排名的一行。排名只统计普通用户的有效最终提交。
type RankingEntry struct {
	Rank              int        `json:"rank"`
	UserID            int64      `json:"user_id"`
	Username          string     `json:"username"`
	Avatar            string     `json:"avatar"`
	Rating            int        `json:"rating"`
	WeightedSolved    float64    `json:"weighted_solved"`
	SolvedProblems    int64      `json:"solved_problems"`
	AttemptedProblems int64      `json:"attempted_problems"`
	FirstBloods       int64      `json:"first_bloods"`
	AcceptanceRate    float64    `json:"acceptance_rate"`
	LastAcceptedAt    *time.Time `json:"last_accepted_at,omitempty"`
}
