# Setup Tarantool

This action will set up [Tarantool](https://www.tarantool.io) environment and **cache the packages**.

- When cached, it takes \~1-2s to finish.
- The first run takes \~40s.
- Cache size is \~20MB.
- Runs on `ubuntu-*` only.

# Usage

### Basic

```yaml
steps:
  - uses: actions/checkout@v2
  - uses: rosik/setup-tarantool@v1
    with:
      tarantool-version: '2.5'
  - run: tarantoolctl rocks make
```

### Custom cache key

By default, the action caches installed apt packages with the key:

```tarantool-setup-${tarantool-version}-${ubuntu-version}```

If you need to drop the cache, it's customizable:

```yaml
steps:
  - uses: rosik/setup-tarantool@v1
    with:
      tarantool-version: 2.5
      cache-key: some-other-key
```

# License

The scripts and documentation in this project are released under the [MIT License](LICENSE).

# Contributions

Contributions are welcome! Just open an issue or send a pull request.
