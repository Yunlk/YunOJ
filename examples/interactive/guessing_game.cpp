// 示例交互器：猜数字游戏
// 协议：argv = [输入文件]（第一行为目标数字 1..1000000），
//       stdin 读选手输出，stdout 写发给选手的数据（每次必须 flush）。
// 退出码：0 = AC（选手猜中），1 = WA（超次数或格式错误），2 = SE。
#include <cstdio>
#include <cstdlib>

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    FILE* f = fopen(argv[1], "r");
    if (!f) return 2;
    long long target = 0;
    if (fscanf(f, "%lld", &target) != 1) return 2;
    fclose(f);

    for (int turn = 0; turn < 60; turn++) {
        long long guess = 0;
        if (scanf("%lld", &guess) != 1) return 1; // 选手输出格式错误或提前退出
        if (guess < 1 || guess > 1000000) return 1;
        if (guess == target) {
            printf("=\n");
            fflush(stdout);
            return 0;
        }
        if (guess < target) printf(">\n"); else printf("<\n");
        fflush(stdout); // 关键：每次写后必须 flush，否则选手读不到
    }
    return 1; // 超过 60 次未猜中
}
