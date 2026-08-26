// YunOJ 评测守护进程：从 Redis 队列消费提交并在 isolate 沙箱中评测。
// 节点通过数据库心跳接收启停与目标并发配置，每个 worker 使用全局唯一消费者 ID。
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/yunoj/yunoj/internal/config"
	"github.com/yunoj/yunoj/internal/judge"
	"github.com/yunoj/yunoj/internal/langs"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/queue"
	"github.com/yunoj/yunoj/internal/store"
)

const (
	popTimeout      = time.Second
	testPopTimeout  = 1500 * time.Millisecond
	heartbeatPeriod = 3 * time.Second
	maxNodeWorkers  = 256
)

type workerHandle struct {
	slot       int
	consumerID string
	stop       chan struct{}
	done       chan struct{}
	stopping   bool
}

func main() {
	cfg := config.Load()
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	if err := langs.LoadExternal(cfg.LanguageConfigPath); err != nil {
		slog.Error("加载语言配置失败", "path", cfg.LanguageConfigPath, "err", err)
		os.Exit(1)
	}

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
	if err := syncLanguages(ctx, st); err != nil {
		slog.Error("同步语言清单失败", "err", err)
		os.Exit(1)
	}
	if n, err := st.BackfillTestcases(ctx, cfg.DataDir); err != nil {
		slog.Error("测试点 manifest 回填失败", "err", err)
	} else if n > 0 {
		slog.Info("测试点 manifest 回填完成", "problems", n)
	}

	q := queue.New(cfg.RedisAddr)
	defer q.Close()
	if err := q.Ping(ctx); err != nil {
		slog.Error("连接 Redis 失败", "err", err)
		os.Exit(1)
	}

	sandbox := judge.NewIsolateSandbox(cfg.IsolatePath, cfg.IsolateDir, cfg.IsolateCG)
	runManager(ctx, st, q, sandbox, cfg)
}

func syncLanguages(ctx context.Context, st *store.Store) error {
	public := langs.PublicAll()
	items := make([]model.JudgeLanguageConfig, 0, len(public))
	for _, language := range public {
		items = append(items, model.JudgeLanguageConfig{
			Key: language.Key, Name: language.Name, Version: language.Version, Enabled: true,
		})
	}
	return st.SyncJudgeLanguages(ctx, items)
}

func nodeLanguages() []model.JudgeNodeLanguage {
	public := langs.PublicAll()
	items := make([]model.JudgeNodeLanguage, 0, len(public))
	for _, language := range public {
		items = append(items, model.JudgeNodeLanguage{
			Key: language.Key, Name: language.Name, Version: language.Version,
		})
	}
	return items
}

func runManager(ctx context.Context, st *store.Store, q *queue.Queue, sandbox judge.Sandbox, cfg config.Config) {
	hostname, _ := os.Hostname()
	workers := map[int]*workerHandle{}
	ticker := time.NewTicker(heartbeatPeriod)
	defer ticker.Stop()

	heartbeat := func() {
		pruneFinishedWorkers(workers)
		node, err := st.HeartbeatJudgeNode(ctx, model.JudgeNode{
			NodeID: cfg.JudgeNodeID, DisplayName: cfg.JudgeNodeName,
			Hostname: hostname, Version: cfg.JudgeVersion,
			ActualConcurrency: len(workers), Languages: nodeLanguages(),
		}, cfg.JudgeWorkers)
		if err != nil {
			slog.Error("评测节点心跳失败", "node", cfg.JudgeNodeID, "err", err)
			return
		}
		target := node.DesiredConcurrency
		if !node.Enabled {
			target = 0
		}
		if target < 0 {
			target = 0
		}
		if target > maxNodeWorkers {
			target = maxNodeWorkers
		}
		reconcileWorkers(ctx, st, q, sandbox, cfg, workers, target)
	}

	heartbeat()
	slog.Info("评测节点启动", "node", cfg.JudgeNodeID, "workers", len(workers))
	for {
		select {
		case <-ctx.Done():
			stopAllWorkers(workers)
			slog.Info("评测节点已停止", "node", cfg.JudgeNodeID)
			return
		case <-ticker.C:
			heartbeat()
		}
	}
}

func pruneFinishedWorkers(workers map[int]*workerHandle) {
	for slot, handle := range workers {
		select {
		case <-handle.done:
			delete(workers, slot)
		default:
		}
	}
}

func reconcileWorkers(ctx context.Context, st *store.Store, q *queue.Queue, sandbox judge.Sandbox,
	cfg config.Config, workers map[int]*workerHandle, target int) {
	active := 0
	for _, handle := range workers {
		if !handle.stopping {
			active++
		}
	}
	if active < target {
		for slot := 0; active < target; slot++ {
			if _, exists := workers[slot]; exists {
				continue
			}
			consumerID := fmt.Sprintf("%s-%d", cfg.JudgeNodeID, slot)
			handle := &workerHandle{
				slot: slot, consumerID: consumerID,
				stop: make(chan struct{}), done: make(chan struct{}),
			}
			workers[slot] = handle
			active++
			go func() {
				defer close(handle.done)
				runWorker(ctx, st, q, sandbox, cfg.DataDir, cfg.JudgeNodeID,
					handle.slot, handle.consumerID, handle.stop)
			}()
		}
		return
	}
	if active <= target {
		return
	}
	slots := make([]int, 0, len(workers))
	for slot, handle := range workers {
		if !handle.stopping {
			slots = append(slots, slot)
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(slots)))
	for _, slot := range slots {
		if active <= target {
			break
		}
		handle := workers[slot]
		handle.stopping = true
		close(handle.stop)
		active--
	}
}

func stopAllWorkers(workers map[int]*workerHandle) {
	for _, handle := range workers {
		if !handle.stopping {
			handle.stopping = true
			close(handle.stop)
		}
	}
	var wg sync.WaitGroup
	for _, handle := range workers {
		wg.Add(1)
		go func(done <-chan struct{}) {
			defer wg.Done()
			<-done
		}(handle.done)
	}
	wg.Wait()
}

func runWorker(ctx context.Context, st *store.Store, q *queue.Queue,
	sandbox judge.Sandbox, dataDir, nodeID string, boxID int, consumerID string, stop <-chan struct{}) {
	logger := slog.With("node", nodeID, "worker", boxID)

	ids, err := q.PeekProcessing(ctx, consumerID)
	if err != nil {
		logger.Error("读取处理中列表失败", "err", err)
	} else if len(ids) > 0 {
		if err := st.ResetRunningByIDs(ctx, ids); err != nil {
			logger.Error("重置遗留提交失败", "err", err)
		} else if err := q.Reclaim(ctx, consumerID); err != nil {
			logger.Error("遗留任务放回队列失败", "err", err)
		} else {
			logger.Info("已恢复崩溃遗留任务", "count", len(ids))
		}
	}

	runner := &judge.Runner{
		Store: st, Sandbox: sandbox, BoxID: boxID, DataDir: dataDir, Queue: q,
		NodeID: nodeID, WorkerID: consumerID,
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-stop:
			return
		default:
		}
		id, err := q.Pop(ctx, consumerID, popTimeout)
		if errors.Is(err, queue.ErrEmpty) {
			runTestTask(ctx, q, runner, logger)
			continue
		}
		if err != nil {
			logger.Error("取任务失败", "err", err)
			select {
			case <-ctx.Done():
				return
			case <-stop:
				return
			case <-time.After(time.Second):
			}
			continue
		}

		if err := runner.Judge(ctx, id); err != nil {
			if errors.Is(err, store.ErrLeaseLost) {
				logger.Warn("丢弃过期评测结果", "submission_id", id)
				_ = q.Done(ctx, consumerID, id)
				continue
			}
			logger.Error("评测失败，任务重新入队", "submission_id", id, "err", err)
			if resetErr := st.ResetRunningByIDs(ctx, []int64{id}); resetErr == nil {
				_ = q.Done(ctx, consumerID, id)
				_ = q.Push(ctx, id)
			}
			continue
		}
		if err := q.Done(ctx, consumerID, id); err != nil {
			logger.Warn("标记任务完成失败", "submission_id", id, "err", err)
		}
	}
}

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
