package model

import "testing"

func TestDifficultyWeights(t *testing.T) {
	want := []float64{1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 4.0, 5.0}
	for i, expected := range want {
		if got := DifficultyWeight(i + 1); got != expected {
			t.Fatalf("DifficultyWeight(%d) = %v, want %v", i+1, got, expected)
		}
	}
	if got := DifficultyWeight(0); got != 0 {
		t.Fatalf("DifficultyWeight(0) = %v, want 0", got)
	}
}

func TestCalculateRating(t *testing.T) {
	if got := CalculateRating(0, 0, 0, 0); got != 1000 {
		t.Fatalf("empty rating = %d, want 1000", got)
	}
	if got := CalculateRating(10, 0, 10, 10); got != 1400 {
		t.Fatalf("perfect rating = %d, want 1400", got)
	}
	if got := CalculateRating(10, 0, 5, 10); got != 1340 {
		t.Fatalf("half pass rating = %d, want 1340", got)
	}
}
