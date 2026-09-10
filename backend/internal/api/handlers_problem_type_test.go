package api

import (
	"testing"

	"github.com/yunoj/yunoj/internal/model"
)

func TestValidateProblemAllowsHackType(t *testing.T) {
	msg := validateProblem(problemPayload{
		Title:               "Hack 题",
		TimeLimitMs:         1000,
		MemoryLimitKb:       64 * 1024,
		Difficulty:          model.MinDifficulty,
		Type:                model.ProblemTypeHack,
		CheckerMode:         model.CheckerModeToken,
		HackGeneratorSource: "int main() { return 0; }",
		HackReferenceSource: "int main() { return 0; }",
		TestcaseScores:      []int{},
	})
	if msg != "" {
		t.Fatalf("hack 题型不应被拒绝: %s", msg)
	}
}
