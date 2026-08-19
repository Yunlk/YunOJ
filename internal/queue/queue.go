// Package queue 基于 Redis 实现提交评测队列。
//
// 可靠性设计：worker 通过 BRPOPLPUSH 把任务原子地从主队列转移到
// 自己的「处理中」列表；评测完成后 LREM 删除。若评测机崩溃，
// 重启时 Recover 会把残留在处理中列表的任务搬回主队列并重置
// 提交状态，从而保证任务不丢失、不重复消费。
package queue

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	mainKey          = "oj:queue:submissions"
	processingPrefix = "oj:queue:processing:"
)

// ErrEmpty 队列在阻塞等待时间内没有新任务。
var ErrEmpty = errors.New("queue empty")

// Queue Redis 评测队列客户端。
type Queue struct {
	rdb *redis.Client
}

// New 创建队列客户端（惰性连接）。
func New(addr string) *Queue {
	return &Queue{rdb: redis.NewClient(&redis.Options{Addr: addr})}
}

// Close 关闭连接。
func (q *Queue) Close() error { return q.rdb.Close() }

// Ping 验证 Redis 连通性。
func (q *Queue) Ping(ctx context.Context) error { return q.rdb.Ping(ctx).Err() }

func processingKey(workerID int) string {
	return fmt.Sprintf("%s%d", processingPrefix, workerID)
}

// Push 将提交 ID 加入评测队列。
func (q *Queue) Push(ctx context.Context, submissionID int64) error {
	return q.rdb.RPush(ctx, mainKey, submissionID).Err()
}

// Pop 阻塞等待一个任务（block 为等待超时，超时返回 ErrEmpty）。
// 任务被原子地移入该 worker 的处理中列表。
func (q *Queue) Pop(ctx context.Context, workerID int, block time.Duration) (int64, error) {
	val, err := q.rdb.BRPopLPush(ctx, mainKey, processingKey(workerID), block).Result()
	if errors.Is(err, redis.Nil) {
		return 0, ErrEmpty
	}
	if err != nil {
		return 0, err
	}
	id, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("队列中数据非法 %q: %w", val, err)
	}
	return id, nil
}

// Done 标记任务处理完成，从处理中列表移除。
func (q *Queue) Done(ctx context.Context, workerID int, submissionID int64) error {
	return q.rdb.LRem(ctx, processingKey(workerID), 1, submissionID).Err()
}

// recoverScript 把处理中列表的全部任务搬回主队列并清空该列表，
// 返回被搬回的任务 ID 列表。
var recoverScript = redis.NewScript(`
local n = redis.call('LRANGE', KEYS[1], 0, -1)
for _, v in ipairs(n) do
	redis.call('RPUSH', KEYS[2], v)
end
redis.call('DEL', KEYS[1])
return n
`)

// Recover 在 worker 启动时调用，找回上次崩溃遗留的任务。
// 返回找回的任务 ID 列表。
func (q *Queue) Recover(ctx context.Context, workerID int) ([]int64, error) {
	vals, err := recoverScript.Run(ctx, q.rdb,
		[]string{processingKey(workerID), mainKey}).StringSlice()
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(vals))
	for _, v := range vals {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// TryLock 尝试获取一个带 TTL 的互斥标记（用于提交限流等场景）。
// 返回 true 表示获取成功（未超限）。
func (q *Queue) TryLock(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	ok, err := q.rdb.SetNX(ctx, key, 1, ttl).Result()
	return ok, err
}

// ---------- 临时测试运行（自测/样例测试，不落库） ----------

const (
	testQueueKey     = "oj:queue:tests"
	testResultPrefix = "oj:test:result:"
)

// ---------- 比赛排行榜更新事件 ----------

const contestEventPrefix = "oj:contest:update:"

// PublishContestUpdate 推送比赛排行榜更新事件（web 端可订阅做实时刷新）。
func (q *Queue) PublishContestUpdate(ctx context.Context, contestID int64) error {
	return q.rdb.Publish(ctx, contestEventPrefix+fmt.Sprint(contestID), "update").Err()
}

// SubscribeContestUpdate 订阅比赛排行榜更新事件。
func (q *Queue) SubscribeContestUpdate(ctx context.Context, contestID int64) *redis.PubSub {
	return q.rdb.Subscribe(ctx, contestEventPrefix+fmt.Sprint(contestID))
}

// PushTest 将测试运行任务（JSON 负载）加入测试队列。
func (q *Queue) PushTest(ctx context.Context, payload string) error {
	return q.rdb.RPush(ctx, testQueueKey, payload).Err()
}

// PopTest 阻塞等待一个测试运行任务，超时返回 ErrEmpty。
// 临时任务无需可靠队列语义：评测机崩溃时调用方等待超时即可，用户重试。
func (q *Queue) PopTest(ctx context.Context, block time.Duration) (string, error) {
	vals, err := q.rdb.BLPop(ctx, block, testQueueKey).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrEmpty
	}
	if err != nil {
		return "", err
	}
	if len(vals) < 2 {
		return "", fmt.Errorf("测试队列返回异常: %v", vals)
	}
	return vals[1], nil
}

// SetTestResult 写入测试运行结果（带 TTL，避免积压）。
func (q *Queue) SetTestResult(ctx context.Context, runID, result string, ttl time.Duration) error {
	return q.rdb.Set(ctx, testResultPrefix+runID, result, ttl).Err()
}

// GetTestResult 读取测试运行结果。found 为 false 表示尚未就绪。
func (q *Queue) GetTestResult(ctx context.Context, runID string) (result string, found bool, err error) {
	result, err = q.rdb.Get(ctx, testResultPrefix+runID).Result()
	if errors.Is(err, redis.Nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return result, true, nil
}
