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
        throw new Error(
          'server replied ${response.message.statusCode}'
        )
      }

      const gpgkey = Buffer.from(await response.readBody())
      await exec.exec('sudo apt-key add - ', [], {input: gpgkey})
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
