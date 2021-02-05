![Test](https://github.com/tarantool/setup-tarantool/workflows/Test/badge.svg)

# Setup Tarantool

This action will set up [Tarantool](https://www.tarantool.io) environment and **cache the packages**.

- When cached, it takes \~1-2s to finish.
- The first run takes \~40s.
- Cache size is \~20MB.
- Runs on GitHub-hosted `ubuntu-*` runners only.

# Usage

### Basic

```yaml
steps:
  - uses: actions/checkout@v2
  - uses: tarantool/setup-tarantool@v1
    with:
      tarantool-version: '2.6'
  - run: tarantoolctl rocks install luatest
  - run: tarantoolctl rocks make
  - run: .rocks/bin/luatest -v
```

# License

The scripts and documentation in this project are released under the [MIT License](LICENSE).

# Contributions

Contributions are welcome! Just open an issue or send a pull request.
