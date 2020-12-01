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

    const response = await httpc.get(baseUrl + '/gpgkey')
    if (response.message.statusCode !== 200) {
      throw new Error(
        `curl ` + baseUrl + `/gpgkey: ${response.message.statusCode}`
      )
    }
    core.info(await response.readBody())
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
