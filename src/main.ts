import * as httpm from '@actions/http-client'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import {pipeline} from 'stream/promises'

const nightlyBuild =
  (core.getInput('nightly-build') || 'false').toUpperCase() === 'TRUE'
const tarantool_version = core.getInput('tarantool-version', {required: true})

// Debian/Ubuntu uses amd64/arm64 naming.
const arch = core.platform.arch === 'x64' ? 'amd64' : core.platform.arch

interface CaptureOptions {
  /** optional.  defaults to false */
  silent?: boolean
}

interface FileInclusion {
  include: boolean
  path: RegExp
}

interface DpkgConfig {
  includes: FileInclusion[]
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

function tarantool_version_major(): number {
  const parts = tarantool_version.split('.', 2)
  return Number(parts[0])
}

function tarantool_version_minor(): number {
  const parts = tarantool_version.split('.', 2)
  return Number(parts[1])
}

let _lsb_release: Promise<string>
async function lsb_release(): Promise<string> {
  if (!_lsb_release) {
    if (tarantool_version_major() >= 3) {
      _lsb_release = Promise.resolve('static')
    } else {
      _lsb_release = capture('lsb_release -c -s', {silent: true})
    }
  }

  return _lsb_release
}

let _lsb_release_id: Promise<string>
async function lsb_release_id(): Promise<string> {
  if (!_lsb_release_id) {
    if (tarantool_version_major() >= 3) {
      _lsb_release_id = Promise.resolve('linux-deb')
    } else {
      _lsb_release_id = capture('lsb_release -i -s', {silent: true})
    }
  }

  return _lsb_release_id
}

let _httpc: httpm.HttpClient
function http_client(): httpm.HttpClient {
  if (!_httpc) {
    _httpc = new httpm.HttpClient('httpc')
  }
  return _httpc
}

async function http_get(url: string): Promise<httpm.HttpClientResponse> {
  core.info('HTTP GET ' + url)
  return http_client().get(url)
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

function construct_base_url(): string {
  const major = tarantool_version_major()
  const minor = tarantool_version_minor()

  var tarantool_series
  // Assume that just 2 is latest 2, so it is 2.10+ too.
  if (
    major >= 3 ||
    (major == 2 && minor >= 10) ||
    (major == 2 && isNaN(minor))
  ) {
    /*
     * 2.10+ -- the new release policy is in effect.
     *
     * A release series is determined by a major version.
     * Nightly builds are not provided.
     *
     * https://github.com/tarantool/tarantool/discussions/6182
     */
    tarantool_series = `series-${major}`
    if (nightlyBuild) {
      throw new Error(`${tarantool_series} does not offer nightly builds`)
    }
  } else {
    /*
     * 1.10, 2.1, ..., 2.8 -- old release policy is in effect.
     *
     * A release series is determined by major and minor
     * versions. There are release and nightly builds (separate
     * repositories).
     */
    tarantool_series = `${major}.${minor}`
  }

  return (
    'https://download.tarantool.org/tarantool/' +
    (nightlyBuild ? '' : 'release/') +
    tarantool_series
  )
}

async function available_versions(
  version_prefix: string
): Promise<Array<string>> {
  const baseUrl = construct_base_url()
  const distro = await lsb_release()
  const distro_id = (await lsb_release_id()).toLowerCase()
  const repo = baseUrl + '/' + distro_id + '/dists/' + distro

  return http_get(`${repo}/main/binary-${arch}/Packages`)
    .then(response => {
      if (response.message.statusCode !== 200) {
        throw new Error(`server replied ${response.message.statusCode}`)
      }
      return response.readBody()
    })
    .then(output => {
      let versions = new Array<string>()
      output
        .split('\n\n')
        .filter(paragraph => paragraph.match(/^Package: tarantool$/m))
        .forEach(paragraph => {
          const match = paragraph.match(/^Version: (.+)$/m)
          if (match) {
            let v = match[1]
            /*
             * Add a full stop or a hyphen into the end of the
             * prefix to, say, don't return 1.10.10, when the
             * version prefix is 1.10.1.
             *
             * The version format varies for series-2 and
             * series-3. Examples:
             *
             * series-2: 2.11.2.g1bac2d257b-1
             * series-3: 3.0.1-1
             *
             * So, we need to add a period and a hyphen both.
             */
            if (
              !version_prefix ||
              v.startsWith(version_prefix + '.') ||
              v.startsWith(version_prefix + '-')
            ) {
              versions.push(v)
            }
          }
        })
      return versions
    })
}

export async function latest_version(
  version_prefix: string = tarantool_version
): Promise<string> {
  return available_versions(version_prefix).then(versions => {
    let max = ''
    versions.forEach(v => {
      max = semver_max(max, v)
    })
    return max
  })
}

function glob_to_regex(glob: string): RegExp {
  return new RegExp(
    glob.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.')
  )
}

function list_files_in_dir(directory: string, files: string[] = []): string[] {
  fs.readdirSync(directory).forEach(file => {
    const p = path.join(directory, file)
    if (fs.statSync(p).isDirectory()) {
      return list_files_in_dir(p, files)
    } else {
      return files.push(p)
    }
  })

  files.sort()
  return files
}

function dpkg_read_config(): DpkgConfig {
  const dpkgConfig: DpkgConfig = {
    includes: []
  }

  const dpkgConfigFilepath = '/etc/dpkg/dpkg.cfg'
  const dpkgConfigDirPath = '/etc/dpkg/dpkg.cfg.d'
  const excludePattern = 'path-exclude='
  const includePattern = 'path-include='

  const configs = list_files_in_dir(dpkgConfigDirPath, [dpkgConfigFilepath])
  configs.forEach(config => {
    try {
      const dpkgExcludesFile = fs.readFileSync(config, 'utf8')

      dpkgExcludesFile.split('\n').forEach(line => {
        // Exclude
        if (line.startsWith(excludePattern)) {
          const regex = glob_to_regex(line.substring(excludePattern.length))
          dpkgConfig.includes.push({
            include: false,
            path: regex
          })
          return
        }

        // Include
        if (line.startsWith(includePattern)) {
          const regex = glob_to_regex(line.substring(includePattern.length))
          dpkgConfig.includes.push({
            include: true,
            path: regex
          })
          return
        }
      })
    } catch (err) {
      core.info(`dpkg excludes file not available: ${err}`)
    }
  })

  // https://groups.google.com/g/linux.debian.bugs.dist/c/w5HiAxl7e7Y
  dpkgConfig.includes.push({
    include: false,
    path: glob_to_regex('/usr/share/man/man3/LIST_*.3')
  })

  return dpkgConfig
}

function dpkg_is_file_included(
  dpkgConfig: DpkgConfig,
  filepath: string
): boolean {
  var included = true

  dpkgConfig.includes.forEach(include => {
    if (include.path.test(filepath)) {
      included = include.include
      return
    }
  })

  return included
}

async function run_linux(): Promise<void> {
  if (arch !== 'amd64' && arch !== 'arm64') {
    throw new Error(`Unsupported arch: ${arch}`)
  }

  const distro = await lsb_release()
  const distro_id = (await lsb_release_id()).toLowerCase()
  const cache_dir = 'cache-tarantool'
  const baseUrl = construct_base_url()

  core.startGroup(`Checking latest tarantool ${tarantool_version} version`)
  const version = await latest_version(tarantool_version)
  if (version == '') {
    throw new Error(
      `There is no tarantool ${tarantool_version} for ` +
        `${distro_id} ${distro} ${arch}`
    )
  }
  core.info(`${version}`)
  core.endGroup()
  if (core.getInput('cache-key')) {
    core.warning("Setup-tarantool input 'cache-key' is deprecated")
  }
  let cache_key = `tarantool-setup-${distro}-${version}-${arch}`
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
    /*
     * trusted.gpg.d makes the key trusted for every repository.
     * Generally, it is not recommended. The modern recommendation
     * is to use the per-repository signed-by attribute.
     *
     * However, we have to support Ubuntu 24.04 and we shouldn't
     * fail if the same repository is added by the action and
     * outside (say, by the installer.sh script). Adding the same
     * repository with and without signed-by would fail with apt
     * 2.8.3 that Ubuntu 24.04 ships. It is fixed in newer apt
     * versions, see [1].
     *
     * [1]: https://salsa.debian.org/apt-team/apt/-/commit/4b537e415aa3888ffe029664bc8238078bdc880a
     */
    await exec.exec('sudo tee /etc/apt/trusted.gpg.d/tarantool.asc', [], {
      input: gpgkey
    })
  })

  await core.group('Setting up repository', async () => {
    await exec.exec('sudo tee /etc/apt/sources.list.d/tarantool.list', [], {
      input: Buffer.from(`deb ${baseUrl}/${distro_id}/ ${distro} main\n`)
    })
  })

  await core.group('Running apt-get update', async () => {
    await exec.exec('sudo apt-get update')
  })

  core.startGroup('Installing tarantool')

  const dpkg_before = await dpkg_list()

  /*
   * The series-3 repository doesn't offer the tarantool-common
   * package.
   */
  let pkgs = [`tarantool=${version}*`, `tarantool-dev=${version}*`]
  if (tarantool_version_major() < 3) {
    pkgs.push(`tarantool-common=${version}*`)
  }
  await exec.exec('sudo apt-get install -y ' + pkgs.join(' '))

  const dpkg_after = await dpkg_list()

  const dpkg_diff: Array<string> = Array.from(dpkg_after.values()).filter(
    pkg => !dpkg_before.has(pkg)
  )

  core.endGroup()

  core.info('Caching APT packages: ' + dpkg_diff.join(', '))

  for (const pkg of dpkg_diff) {
    const dpkgConfig = dpkg_read_config()
    const output = await capture(`sudo dpkg -L ${pkg}`, {silent: true})
    const files: Array<string> = output
      .split('\n')
      .filter(f => dpkg_is_file_included(dpkgConfig, f))
      .filter(f => {
        try {
          return fs.statSync(f).isFile()
        } catch (err) {
          throw new Error(
            `Error while checking file ${f} from package ${pkg}: ${err}`
          )
        }
      })
    for (const f of files) {
      const dest = path.join(cache_dir, path.dirname(f))
      await io.mkdirP(dest)
      await io.cp(f, dest)
    }
  }

  try {
    await cache.saveCache([cache_dir], cache_key)
    core.info(`Cache saved with key: ${cache_key}`)
  } catch (error: unknown) {
    if (error instanceof Error) {
      core.warning(error.message)
    }
    core.warning(`Saving cache failed, but it's not crucial`)
  }

  await io.rmRF(cache_dir)
}

interface GitHubRelease {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: {name: string}[]
}

function tt_archive_name(version: string): string {
  return `tt-${version}-linux-${arch}.tar.gz`
}

/*
 * tt is installed only if requested. tt 3 doesn't support
 * tarantool < 3, so tt 2 is installed for it whatever is
 * requested.
 */
function tt_version_prefix(): string {
  const requested = core.getInput('tt-version')
  if (
    requested &&
    tarantool_version_major() < 3 &&
    Number(requested.split('.')[0]) >= 3
  ) {
    core.warning(
      `tt ${requested} doesn't support tarantool ${tarantool_version}, ` +
        `installing tt 2 instead`
    )
    return '2'
  }
  return requested
}

/*
 * tt versions are taken from the tags of its GitHub releases,
 * say, v2.15.0. Drafts and releases without an archive for the
 * arch (say, 2.15.1 has no arm64 one) are skipped. A pre-release,
 * say, 3.0.0-alpha.1, is taken only if it is requested exactly,
 * so tt 3 gives the latest stable tt 3.
 */
async function tt_available_versions(
  version_prefix: string
): Promise<Array<string>> {
  let headers: {[name: string]: string} = {
    Accept: 'application/vnd.github+json'
  }
  /*
   * An unauthenticated client may perform only 60 requests per
   * hour, so pass a token if there is one. It is valid for
   * github.com only, not for a GitHub Enterprise Server.
   */
  const token = core.getInput('github-token')
  if (token && process.env['GITHUB_SERVER_URL'] === 'https://github.com') {
    headers['Authorization'] = `Bearer ${token}`
  }

  let versions = new Array<string>()
  for (let page = 1; ; page++) {
    const url =
      'https://api.github.com/repos/tarantool/tt/releases' +
      `?per_page=100&page=${page}`
    core.info('HTTP GET ' + url)
    const response = await http_client().getJson<GitHubRelease[]>(url, headers)
    const releases = response.result || []
    if (releases.length === 0) {
      return versions
    }
    releases
      .filter(r => !r.draft)
      .forEach(r => {
        const v = r.tag_name.replace(/^v/, '')
        if (
          (v === version_prefix ||
            (!r.prerelease && v.startsWith(version_prefix + '.'))) &&
          r.assets.some(a => a.name === tt_archive_name(v))
        ) {
          versions.push(v)
        }
      })
  }
}

async function tt_latest_version(version_prefix: string): Promise<string> {
  let max = ''
  ;(await tt_available_versions(version_prefix)).forEach(v => {
    max = semver_max(max, v)
  })
  return max
}

/*
 * tt is a static executable, so it is taken from the release
 * archive as is and added to PATH.
 */
async function install_tt(): Promise<void> {
  const tt_prefix = tt_version_prefix()
  if (!tt_prefix) {
    return
  }

  core.startGroup(`Checking latest tt ${tt_prefix} version`)
  const version = await tt_latest_version(tt_prefix)
  if (version == '') {
    throw new Error(`There is no tt ${tt_prefix} release for ${arch}`)
  }
  core.info(`${version}`)
  core.endGroup()

  // A self-hosted runner keeps the tool cache between jobs.
  const tool_cache = process.env['RUNNER_TOOL_CACHE'] || os.tmpdir()
  const dir = path.join(tool_cache, 'tt', version, arch)
  if (fs.existsSync(path.join(dir, 'tt'))) {
    core.info(`tt ${version} is found in ${dir}`)
    core.addPath(dir)
    return
  }

  await core.group(`Installing tt ${version}`, async () => {
    const name = tt_archive_name(version)
    const url =
      'https://github.com/tarantool/tt/releases/download/' +
      `v${version}/${name}`
    const response = await http_get(url)
    if (response.message.statusCode !== 200) {
      throw new Error(`server replied ${response.message.statusCode}`)
    }

    const temp = process.env['RUNNER_TEMP'] || os.tmpdir()
    const archive = path.join(temp, name)
    await pipeline(response.message, fs.createWriteStream(archive))

    await io.mkdirP(dir)
    await exec.exec('tar', ['-xzf', archive, '-C', dir, 'tt'])
    await io.rmRF(archive)
  })

  core.addPath(dir)
}

export async function run(): Promise<void> {
  if (process.platform !== 'linux') {
    core.setFailed(`Action doesn't support ${process.platform} platform`)
    return
  }

  await run_linux()
    .then(_ => {
      return exec.exec('tarantool --version')
    })
    .then(_ => {
      return install_tt()
    })
    .then(_ => {
      if (core.getInput('tt-version')) {
        return exec.exec('tt version')
      }
    })
    .catch(error => {
      if (error instanceof Error) {
        core.setFailed(error.message)
      } else {
        core.setFailed(`No error message`)
      }
    })
}

// Export core.setOutput() to use in testing of setup-tarantool.
export function setActionOutput(name: string, value: any): void {
  core.setOutput(name, value)
}
