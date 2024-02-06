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
  - uses: actions/checkout@v4
  - uses: tarantool/setup-tarantool@v2
    with:
      tarantool-version: '2.10'
  - run: tarantoolctl rocks install luatest
  - run: tarantoolctl rocks make
  - run: .rocks/bin/luatest -v
```

### Install an exact version

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: tarantool/setup-tarantool@v2
    with:
      tarantool-version: '2.10.4'
```

### Install a nightly build

*Important:* nightly builds are not available for 2.10.0 and newer.

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: tarantool/setup-tarantool@v2
    with:
      tarantool-version: '2.6'  # or, say, '2.6.1.0' for exact version
      nightly-build: true
```

# License

The scripts and documentation in this project are released under the [MIT License](LICENSE).

# Contributions

Contributions are welcome! Just open an issue or send a pull request.

Check out [HACKING.md](./HACKING.md) file for hints.
