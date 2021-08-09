import * as httpm from '@actions/http-client'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'

import * as path from 'path'
import * as fs from 'fs'

const nightlyBuild =
  (core.getInput('nightly-build') || 'false').toUpperCase() === 'TRUE'
const baseUrl =
  'https://download.tarantool.org/tarantool/' +
  (nightlyBuild ? '' : 'release/') +
  core.getInput('tarantool-version')

interface CaptureOptions {
  /** optional.  defaults to false */
  silent?: boolean
}

async function capture(cmd: string, options?: CaptureOptions): Promise<string> {
  let output = ''

  await exec.exec(cmd, [], {
    silent: options && options.silent,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString()
      }
    }
  })

  return output.trim()
}

let _lsb_release: Promise<string>
async function lsb_release(): Promise<string> {
  if (!_lsb_release) {
    _lsb_release = capture('lsb_release -c -s', {silent: true})
  }

  return _lsb_release
}

let _httpc: httpm.HttpClient
async function http_get(url: string): Promise<httpm.HttpClientResponse> {
  if (!_httpc) {
    _httpc = new httpm.HttpClient('httpc')
  }
  core.info('HTTP GET ' + url)
  return _httpc.get(url)
}

async function dpkg_list(): Promise<Set<string>> {
  const cmd = 'sudo dpkg-query -W -f "${binary:Package}\\n"'
  const output: string = await capture(cmd, {silent: true})

  let ret = new Set<string>()
  output.split('\n').forEach(l => ret.add(l))
  return ret
}

function semver_max(a: string, b: string): string {
  const re = /[.-]/
  var pa = a.split(re)
  var pb = b.split(re)
  for (var i = 0; ; i++) {
    var na = Number(pa[i])
    var nb = Number(pb[i])
    if (na > nb) return a
    if (nb > na) return b
    if (!isNaN(na) && isNaN(nb)) return a
    if (isNaN(na) && !isNaN(nb)) return b
    if (isNaN(na) && isNaN(nb)) return pa[i] >= pb[i] ? a : b
  }
}

export async function latest_version(): Promise<string> {
  const repo = baseUrl + '/ubuntu/dists/' + (await lsb_release())
  return http_get(`${repo}/main/binary-amd64/Packages`)
    .then(response => {
      if (response.message.statusCode !== 200) {
        throw new Error(`server replied ${response.message.statusCode}`)
      }
      return response.readBody()
    })
    .then(output => {
      let ret = ''
      output
        .split('\n\n')
        .filter(paragraph => paragraph.startsWith('Package: tarantool\n'))
        .forEach(paragraph => {
          const match = paragraph.match(/^Version: (.+)$/m)
          const version = match ? match[1] : ret
          ret = semver_max(ret, version)
        })
      return ret
    })
}

async function run_linux(): Promise<void> {
  try {
    const distro = await lsb_release()
    const cache_dir = 'cache-tarantool'

    core.startGroup('Checking latest tarantool version')
    const version = await latest_version()
    core.info(`${version}`)
    core.endGroup()

    if (core.getInput('cache-key')) {
      core.warning("Setup-tarantool input 'cache-key' is deprecated")
    }
    let cache_key = `tarantool-setup-${distro}-${version}`
    // This for testing only
    cache_key += process.env['TARANTOOL_CACHE_KEY_SUFFIX'] || ''

    if (await cache.restoreCache([cache_dir], cache_key)) {
      core.info(`Cache restored from key: ${cache_key}`)
      await exec.exec(`sudo rsync -aK "${cache_dir}/" /`)
      await io.rmRF(cache_dir)
      return
    } else {
      core.info(`Cache not found for input key: ${cache_key}`)
    }

    await core.group('Adding gpg key', async () => {
      const response = await http_get(baseUrl + '/gpgkey')
      if (response.message.statusCode !== 200) {
        throw new Error(`server replied ${response.message.statusCode}`)
      }

      const gpgkey = Buffer.from(await response.readBody())
      await exec.exec('sudo apt-key add - ', [], {input: gpgkey})
    })

    await core.group('Setting up repository', async () => {
      await exec.exec('sudo tee /etc/apt/sources.list.d/tarantool.list', [], {
        input: Buffer.from(`deb ${baseUrl}/ubuntu/ ${distro} main\n`)
      })
    })

    await core.group('Running apt-get update', async () => {
      await exec.exec('sudo apt-get update')
    })

    core.startGroup('Installing tarantool')

    const dpkg_before = await dpkg_list()
    await exec.exec('sudo apt-get install -y tarantool tarantool-dev')
    const dpkg_after = await dpkg_list()

    const dpkg_diff: Array<string> = Array.from(dpkg_after.values()).filter(
      pkg => !dpkg_before.has(pkg)
    )

    core.endGroup()

    core.info('Caching APT packages: ' + dpkg_diff.join(', '))

    for (const pkg of dpkg_diff) {
      const output = await capture(`sudo dpkg -L ${pkg}`, {silent: true})
      const files: Array<string> = output
        .split('\n')
        .filter(f => fs.statSync(f).isFile())
      for (const f of files) {
        const dest = path.join(cache_dir, path.dirname(f))
        await io.mkdirP(dest)
        await io.cp(f, dest)
      }
    }

    try {
      await cache.saveCache([cache_dir], cache_key)
      core.info(`Cache saved with key: ${cache_key}`)
    } catch (error) {
      core.warning(error.message)
      core.warning(`Saving cache failed, but it's not crucial`)
    }

    await io.rmRF(cache_dir)
  } catch (error) {
    core.setFailed(error.message)
  }
}

async function run_macos(): Promise<void> {
  try {
    core.startGroup('Installing tarantool')
    await exec.exec(`brew install tarantool`)
    core.endGroup()
  } catch (error) {
    core.setFailed(error.message)
  }
}

export async function run(): Promise<void> {
  if (process.platform === 'linux') {
    await run_linux()
  } else if (process.platform === 'darwin') {
    await run_macos()
  } else {
    core.setFailed(`Action doesn't support ${process.platform} platform`)
  }

  await exec.exec('tarantool --version')
}
