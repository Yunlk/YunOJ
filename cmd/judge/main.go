// YunOJ 评测守护进程：从 Redis 队列消费提交并在 isolate 沙箱中评测。
// 每个 worker 独占一个沙箱编号，互不干扰，可水平扩展。
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/yunoj/yunoj/internal/config"
	"github.com/yunoj/yunoj/internal/judge"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/queue"
	"github.com/yunoj/yunoj/internal/store"
)

const (
	popTimeout     = 1 * time.Second // 提交队列短阻塞，让测试任务有机会被处理
	testPopTimeout = 1500 * time.Millisecond
)

func main() {
	cfg := config.Load()
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("连接数据库失败", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	if err := model.Migrate(ctx, st.Pool()); err != nil {
		slog.Error("数据库迁移失败", "err", err)
		os.Exit(1)
	}

	q := queue.New(cfg.RedisAddr)
	defer q.Close()
	if err := q.Ping(ctx); err != nil {
		slog.Error("连接 Redis 失败", "err", err)
		os.Exit(1)
	}

	sandbox := judge.NewIsolateSandbox(cfg.IsolatePath, cfg.IsolateDir, cfg.IsolateCG)

	var wg sync.WaitGroup
	for i := 0; i < cfg.JudgeWorkers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			runWorker(ctx, st, q, sandbox, cfg.DataDir, workerID)
		}(i)
	}

	slog.Info("评测服务启动", "workers", cfg.JudgeWorkers)
	wg.Wait()
	slog.Info("评测服务已停止")
}

// runWorker 单个评测 worker 的主循环。
func runWorker(ctx context.Context, st *store.Store, q *queue.Queue,
	sandbox judge.Sandbox, dataDir string, workerID int) {

	logger := slog.With("worker", workerID)

	// 启动恢复：找回上次崩溃遗留的处理中任务
	ids, err := q.Recover(ctx, workerID)
	if err != nil {
		logger.Error("恢复队列失败", "err", err)
	} else if len(ids) > 0 {
		if err := st.ResetRunningByIDs(ctx, ids); err != nil {
			logger.Error("重置遗留提交失败", "err", err)
		} else {
			logger.Info("已恢复崩溃遗留任务", "count", len(ids))
		}
	}

	runner := &judge.Runner{
		Store:   st,
		Sandbox: sandbox,
		BoxID:   workerID,
		DataDir: dataDir,
		Queue:   q,
	}

	for {
		if ctx.Err() != nil {
			return
		}
		id, err := q.Pop(ctx, workerID, popTimeout)
		if errors.Is(err, queue.ErrEmpty) {
			// 无提交任务时处理临时测试运行（自测/样例测试）
			if !runTestTask(ctx, q, runner, logger) {
				continue
			}
			continue
		}
		if err != nil {
			logger.Error("取任务失败", "err", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			continue
		}

		if err := runner.Judge(ctx, id); err != nil {
			// 评测内部出错：任务留在处理中列表，下次启动会恢复重试
			logger.Error("评测失败", "submission_id", id, "err", err)
		}
		if err := q.Done(ctx, workerID, id); err != nil {
			logger.Warn("标记任务完成失败", "submission_id", id, "err", err)
		}
	}
}

// runTestTask 消费一个临时测试运行任务并写回结果。返回是否有任务被处理。
func runTestTask(ctx context.Context, q *queue.Queue, runner *judge.Runner, logger *slog.Logger) bool {
	payload, err := q.PopTest(ctx, testPopTimeout)
	if errors.Is(err, queue.ErrEmpty) {
		return false
	}
	if err != nil {
		logger.Error("取测试任务失败", "err", err)
		return false
	}
	var task judge.TestTask
	if err := json.Unmarshal([]byte(payload), &task); err != nil {
		logger.Error("测试任务解析失败", "err", err)
		return true
	}
	result := runner.Test(ctx, task)
	out, err := json.Marshal(result)
	if err != nil {
		logger.Error("测试结果序列化失败", "err", err)
		return true
	}
	if err := q.SetTestResult(ctx, task.RunID, string(out), 60*time.Second); err != nil {
		logger.Error("写回测试结果失败", "run_id", task.RunID, "err", err)
	}
	logger.Info("测试运行完成", "run_id", task.RunID, "status", result.Status, "cases", len(result.Cases))
	return true
}
