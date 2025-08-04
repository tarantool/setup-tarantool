![Test](https://github.com/tarantool/setup-tarantool/workflows/Test/badge.svg)

# Setup Tarantool

This action will set up [Tarantool](https://www.tarantool.io) environment and **cache the packages**.

- When cached, it takes \~1-2s to finish.
- The first run takes \~40s.
- Cache size is 20MB-30MB.
- Runs on GitHub-hosted `ubuntu-*` runners.
- Runs on Debian/Ubuntu self-hosted runners.
- Runs inside Debian/Ubuntu container jobs.

# Usage

### Basic

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: tarantool/setup-tarantool@v4
    with:
      tarantool-version: '2.11'
  - run: tarantoolctl rocks install luatest
  - run: tarantoolctl rocks make
  - run: .rocks/bin/luatest -v
```

### Install an exact version

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: tarantool/setup-tarantool@v4
    with:
      tarantool-version: '2.11.7'
```

### Install a nightly build

*Important:* nightly builds are not available for 2.10.0 and newer.

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: tarantool/setup-tarantool@v4
    with:
      tarantool-version: '2.6'  # or, say, '2.6.1.0' for exact version
      nightly-build: true
```

### Self-hosted runners and container jobs

It requires an additional step to bring dependencies needed for the action
itself. These dependencies are preinstalled on GitHub hosted runners, but a
self-hosted runner and a docker image may miss them.

Configuring `apt-get` to skip recommended and suggested packages reduces the
cache size from \~200MiB to \~30MiB.

```yaml
jobs:
  myjob:
    runs-on: ubuntu-latest
    container:
      image: debian:bookworm

    env:
      DEBIAN_FRONTEND: noninteractive

    steps:
      - name: Configure apt-get
        run: |
          mkdir -p /etc/apt/apt.conf.d
          printf '%s\n%s\n'                    \
            'APT::Install-Recommends "false";' \
            'APT::Install-Suggests "false";'   \
            > /etc/apt/apt.conf.d/no-recommends-no-suggests.conf

      - name: Update repositories metadata
        run: |
          apt-get -y update

      - name: Workaround interactive tzdata configuration problem (gh-50)
        run:
          apt-get -y install tzdata

      - name: Install setup-tarantool dependencies
        run: |
          apt-get -y install sudo lsb-release gnupg ca-certificates rsync

      - uses: tarantool/setup-tarantool@v4
        with:
          tarantool-version: '2.11'
```

# License

The scripts and documentation in this project are released under the [MIT License](LICENSE).

# Contributions

Contributions are welcome! Just open an issue or send a pull request.

Check out [HACKING.md](./HACKING.md) file for hints.
