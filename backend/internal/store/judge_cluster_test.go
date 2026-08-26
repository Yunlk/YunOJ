package store

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

func TestClaimForJudgeIsAtomic(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	problem := createTestProblem(t, st, model.ProblemStatusPublished)
	suffix := time.Now().UnixNano()
	user, err := st.CreateUser(ctx, fmt.Sprintf("judge_claim_%d", suffix),
		fmt.Sprintf("judge_claim_%d@example.invalid", suffix), "test", model.RoleStudent)
	if err != nil {
		t.Fatalf("创建测试用户失败: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, user.ID)
	})
	submissionID, err := st.CreateSubmission(ctx, problem.ID, user.ID, "cpp", "int main(){}", true)
	if err != nil {
		t.Fatalf("创建提交失败: %v", err)
	}

	var claimed atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			_, ok, claimErr := st.ClaimForJudge(ctx, submissionID, "test-node",
				fmt.Sprintf("test-node-%d", worker), time.Minute)
			if claimErr != nil {
				t.Errorf("领取失败: %v", claimErr)
				return
			}
			if ok {
				claimed.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if got := claimed.Load(); got != 1 {
		t.Fatalf("并发领取成功数 = %d，期望 1", got)
	}
}

func TestStaleJudgeCannotOverwriteNewAttempt(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	problem := createTestProblem(t, st, model.ProblemStatusPublished)
	suffix := time.Now().UnixNano()
	user, err := st.CreateUser(ctx, fmt.Sprintf("judge_fence_%d", suffix),
		fmt.Sprintf("judge_fence_%d@example.invalid", suffix), "test", model.RoleStudent)
	if err != nil {
		t.Fatalf("创建测试用户失败: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, user.ID)
	})
	submissionID, err := st.CreateSubmission(ctx, problem.ID, user.ID, "cpp", "int main(){}", true)
	if err != nil {
		t.Fatalf("创建提交失败: %v", err)
	}

	firstAttempt, claimed, err := st.ClaimForJudge(ctx, submissionID, "node-a", "node-a-0", time.Minute)
	if err != nil || !claimed {
		t.Fatalf("首次领取失败: claimed=%v err=%v", claimed, err)
	}
	if err := st.ResetRunningByIDs(ctx, []int64{submissionID}); err != nil {
		t.Fatalf("恢复提交失败: %v", err)
	}
	secondAttempt, claimed, err := st.ClaimForJudge(ctx, submissionID, "node-b", "node-b-0", time.Minute)
	if err != nil || !claimed {
		t.Fatalf("二次领取失败: claimed=%v err=%v", claimed, err)
	}
	if secondAttempt <= firstAttempt {
		t.Fatalf("attempt 未递增: first=%d second=%d", firstAttempt, secondAttempt)
	}

	err = st.SetJudgedClaimed(ctx, submissionID, "node-a", "node-a-0", firstAttempt,
		model.StatusWrongAnswer, "", nil, 1, 1)
	if !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("旧租约写回应返回 ErrLeaseLost，实际 %v", err)
	}
	if err := st.SetJudgedClaimed(ctx, submissionID, "node-b", "node-b-0", secondAttempt,
		model.StatusAccepted, "", nil, 1, 1); err != nil {
		t.Fatalf("当前租约写回失败: %v", err)
	}
	got, err := st.GetSubmission(ctx, submissionID)
	if err != nil || got.Status != model.StatusAccepted {
		t.Fatalf("最终状态应为 accepted，实际 status=%s err=%v", got.Status, err)
	}
}

func TestJudgeNodeHeartbeatPreservesAdminConfig(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	nodeID := fmt.Sprintf("test-node-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = st.pool.Exec(context.Background(), `DELETE FROM judge_nodes WHERE node_id = $1`, nodeID)
	})

	first, err := st.HeartbeatJudgeNode(ctx, model.JudgeNode{
		NodeID: nodeID, DisplayName: "初始名称", Hostname: "host-a",
		Version: "test", ActualConcurrency: 2,
	}, 2)
	if err != nil {
		t.Fatalf("首次心跳失败: %v", err)
	}
	if first.DesiredConcurrency != 2 || !first.Enabled {
		t.Fatalf("首次配置不正确: %+v", first)
	}
	desired := 5
	enabled := false
	name := "后台名称"
	if err := st.UpdateJudgeNode(ctx, nodeID, &name, &enabled, &desired); err != nil {
		t.Fatalf("更新节点失败: %v", err)
	}
	second, err := st.HeartbeatJudgeNode(ctx, model.JudgeNode{
		NodeID: nodeID, DisplayName: "不应覆盖", Hostname: "host-b",
		Version: "test-2", ActualConcurrency: 1,
	}, 9)
	if err != nil {
		t.Fatalf("二次心跳失败: %v", err)
	}
	if second.DisplayName != name || second.Enabled || second.DesiredConcurrency != desired {
		t.Fatalf("心跳覆盖了后台配置: %+v", second)
	}
	if second.Hostname != "host-b" || second.ActualConcurrency != 1 {
		t.Fatalf("心跳运行状态未刷新: %+v", second)
	}
}
