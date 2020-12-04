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

    let cache_key = core.getInput('cache-key', {required: false})
    if (!cache_key) {
      cache_key = 'tarantool-setup-' + process.platform + '-' + t_version
    }

    const cache_dir = path.join(cache_key)

    if (await cache.restoreCache([cache_dir], cache_key)) {
      for (const f of fs.readdirSync(cache_dir)) {
        await exec.exec(`sudo cp -f -r "${cache_dir}/${f}" /`)
      }
      await io.rmRF(cache_dir)
      return
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
      const release = await capture('lsb_release -c -s')
      await exec.exec('sudo tee /etc/apt/sources.list.d/tarantool.list', [], {
        input: Buffer.from(`deb ${baseUrl}/ubuntu/ ${release} main\n`)
      })
    })

    await core.group('Running apt-get update', async () => {
      await exec.exec('sudo apt-get update')
    })

    let dpkg_diff: Array<string>

    await core.group('Installing tarantool', async () => {
      const dpkg_before = await dpkg_list()
      await exec.exec('sudo apt-get install -y tarantool tarantool-dev')
      const dpkg_after = await dpkg_list()

      dpkg_diff = Array.from(dpkg_after.values()).filter(
        pkg => !dpkg_before.has(pkg)
      )
    })

    await core.group('Cache apt packages', async () => {
      core.info('Will cache ' + dpkg_diff.join(', '))
      // let paths: Array<string> = []

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

      await cache.saveCache([cache_dir], cache_key)
      core.info(`Cache saved with key: ${cache_key}`)
      await io.rmRF(cache_dir)
    })
  } catch (error) {
    core.setFailed(error.message)
  }
}

async function run(): Promise<void> {
  if (process.platform === 'linux') {
    return await run_linux()
  } else {
    core.setFailed(`Action doesn't support ${process.platform} platform`)
  }
}

run()

export default run
