// 示例 SPJ：多解比较器
// 协议：argv = [输入文件, 用户输出文件, 答案文件]，stdin 不使用。
// 退出码：0 = AC，1 = WA，2 = PE，其他 = SE。
// 答案文件格式：第一行为合法答案个数 N，接下来 N 行每行一个合法答案。
// 判定规则：用户输出的第一个非空行与任一合法答案完全一致（忽略行尾空白）即 AC。
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

static std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    size_t b = s.find_last_not_of(" \t\r\n");
    if (a == std::string::npos) return "";
    return s.substr(a, b - a + 1);
}

static bool readFirstLine(const char* path, std::string& out) {
    FILE* f = fopen(path, "r");
    if (!f) return false;
    char buf[8192];
    bool got = false;
    while (fgets(buf, sizeof(buf), f)) {
        std::string line = trim(buf);
        if (!line.empty()) { out = line; got = true; break; }
    }
    fclose(f);
    return got;
}

int main(int argc, char** argv) {
    if (argc != 4) return 3;
    std::string user;
    if (!readFirstLine(argv[2], user)) return 1;

    FILE* f = fopen(argv[3], "r");
    if (!f) return 3;
    int n = 0;
    if (fscanf(f, "%d", &n) != 1 || n <= 0) { fclose(f); return 3; }
    char buf[8192];
    fgets(buf, sizeof(buf), f); // 跳过 N 所在行剩余内容
    for (int i = 0; i < n; i++) {
        if (!fgets(buf, sizeof(buf), f)) break;
        if (trim(buf) == user) { fclose(f); return 0; }
    }
    fclose(f);
    return 1;
}
