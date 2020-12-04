import * as httpm from '@actions/http-client'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'

async function run_linux(): Promise<void> {
  try {
    const httpc = new httpm.HttpClient('httpc')
    const t_version = core.getInput('tarantool-version', {required: true})
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
      let release = ''
      await exec.exec('lsb_release -c -s', [], {
        listeners: {
          stdout: (data: Buffer) => {
            release += data.toString()
          }
        }
      })

      release = release.trim()
      await exec.exec('sudo tee /etc/apt/sources.list.d/tarantool.list', [], {
        input: Buffer.from(`deb ${baseUrl}/ubuntu/ ${release} main\n`)
      })
    })

    await core.group('Running apt-get update', async () => {
      await exec.exec('sudo apt-get update')
    })

    let dpkg_diff = new Set<string>()
    await core.group('Installing tarantool', async () => {
      async function dpkg_list(): Promise<Set<string>> {
        let output = ''

        await exec.exec('sudo dpkg-query -W -f "${binary:Package}\\n"', [], {
          silent: true,
          listeners: {
            stdout: (data: Buffer) => {
              output += data.toString()
            }
          }
        })

        let ret = new Set<string>()
        output
          .trim()
          .split('\n')
          .forEach(l => {
            ret.add(l)
          })
        return ret
      }

      const dpkg_before = await dpkg_list()
      await exec.exec('sudo apt-get install -y tarantool tarantool-dev')
      const dpkg_after = await dpkg_list()

      dpkg_after.forEach(l => {
        if (!dpkg_before.has(l)) {
          dpkg_diff.add(l)
        }
      })
    })

    dpkg_diff.forEach(l => {
      core.info('New deb package: ' + l)
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
