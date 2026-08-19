# Custom toolchains

Place locally managed compilers or interpreters in this directory. Docker Compose
mounts it read-only at `/opt/toolchains` inside the judge container and sandbox.
Define language metadata and argv-style compile/run commands in
`config/languages.json`; use `config/languages.example.json` as the schema example.

Do not place untrusted executables here. Language configuration is an operator-level
deployment capability, not an end-user upload mechanism.
