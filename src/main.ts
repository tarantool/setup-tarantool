import * as httpm from '@actions/http-client'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'

import * as path from 'path'
import * as fs from 'fs'

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

async function dpkg_list(): Promise<Set<string>> {
  const cmd = 'sudo dpkg-query -W -f "${binary:Package}\\n"'
  const output: string = await capture(cmd, {silent: true})

  let ret = new Set<string>()
  output.split('\n').forEach(l => ret.add(l))
  return ret
}

async function run_linux(): Promise<void> {
  try {
    const httpc = new httpm.HttpClient('httpc')
    const t_version = core.getInput('tarantool-version', {required: true})
    const lsb_release = await capture('lsb_release -c -s', {silent: true})
    const cache_dir = 'cache-tarantool'
    const cache_key =
      core.getInput('cache-key') ||
      `tarantool-setup-${t_version}-${lsb_release}`

    if (await cache.restoreCache([cache_dir], cache_key)) {
      core.info(`Cache restored from key: ${cache_key}`)
      await exec.exec(`sudo rsync -aK "${cache_dir}/" /`)
      await io.rmRF(cache_dir)
      return
    } else {
      core.info(`Cache not found for input key: ${cache_key}`)
    }

    const baseUrl =
      'https://download.tarantool.org/tarantool/release/' + t_version

    await core.group('Adding gpg key', async () => {
      const url = baseUrl + '/gpgkey'
      core.info('curl ' + url)

      const response = await httpc.get(url)
      if (response.message.statusCode !== 200) {
        throw new Error('server replied ${response.message.statusCode}')
      }

      const gpgkey = Buffer.from(await response.readBody())
      await exec.exec('sudo apt-key add - ', [], {input: gpgkey})
    })

    await core.group('Setting up repository', async () => {
      await exec.exec('sudo tee /etc/apt/sources.list.d/tarantool.list', [], {
        input: Buffer.from(`deb ${baseUrl}/ubuntu/ ${lsb_release} main\n`)
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

async function run(): Promise<void> {
  if (process.platform === 'linux') {
    await run_linux()
  } else {
    core.setFailed(`Action doesn't support ${process.platform} platform`)
  }

  await exec.exec('tarantool --version')
}

run()

export default run
