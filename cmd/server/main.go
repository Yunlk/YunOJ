// YunOJ web/API 服务：提供 HTTP API 与嵌入的前端静态资源。
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/yunoj/yunoj/internal/api"
	"github.com/yunoj/yunoj/internal/config"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/queue"
	"github.com/yunoj/yunoj/internal/store"
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

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.New(cfg, st, q).Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      5 * time.Minute, // 留足测试数据上传时间
		IdleTimeout:       2 * time.Minute,
	}

	go func() {
		slog.Info("服务启动", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("服务异常退出", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("正在关闭服务")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
