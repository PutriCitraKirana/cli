import { useDownload, usePrefix, useOffLicense } from "hooks"
import { Package, Stowed, SupportedArchitectures, SupportedPlatform, Stowage } from "types"
import * as utils from "utils"
import SemVer from "semver"
import Path from "path"

export default function useCache() {
  return { download, ls, path }
}

type DownloadOptions = {
  type: 'bottle'
  pkg: Package
} | {
  type: 'src',
  url: URL
  pkg: Package
} | {
  type: 'script',
  url: URL
}

/// download source or bottle
const download = async (opts: DownloadOptions) => {
  const { download } = useDownload()

  const { type } = opts
  let url: URL
  if (type == 'bottle') {
    url = useOffLicense('s3').url({ pkg: opts.pkg, type: 'bottle', compression: 'gz' })
  } else {
    url = opts.url
  }

  const headers: HeadersInit = {}
  let dst: Path | undefined
  switch (type) {
  case 'bottle':
    dst = path({ pkg: opts.pkg, type: 'bottle', compression: 'gz' })

    //FIXME: big hacks
    if (opts.pkg.project === "tea.xyz" && url.host === "github.com") {
      const token = Deno.env.get("GITHUB_TOKEN")
      if (!token) { throw new Error("private repos require a GITHUB_TOKEN") }
      headers["Authorization"] = `bearer ${token}`
    }

    break
  case 'src': {
    const extname = new Path(url.pathname).extname()
    dst = path({ pkg: opts.pkg, type: 'src', extname })
  } break
  case 'script':
    dst = undefined
  }

  return await download({ src: url, dst, headers })
}

const path = (stowage: Stowage) => {
  const { pkg, type } = stowage
  const stem = pkg.project.replaceAll("/", "∕")

  let filename = `${stem}-${pkg.version}`
  if (type == 'bottle') {
    const { platform, arch } = stowage.host ?? utils.host()
    filename += `+${platform}+${arch}.tar.${stowage.compression}`
  } else {
    filename += stowage.extname
  }

  return usePrefix().www.join(filename)
}

const ls = async () => {
  const rv: Stowed[] = []

  for await (const [path, {name, isFile}] of usePrefix().www.ls()) {
    if (!isFile) continue
    const match = name.match(`^(.*)-([0-9]+\\.[0-9]+\\.[0-9]+)(\\+(.+?)\\+(.+?))?\\.tar\\.[gx]z$`)
    if (!match) { continue }
    const [_, p, v, host, platform, arch] = match
    // Gotta undo the package name manipulation to get the package from the bottle
    const project = p.replaceAll("∕", "/")
    const version = new SemVer(v)
    if (!version) { continue }
    const pkg = { project, version }
    if (host) {
      const compression = path.extname() == '.tar.gz' ? 'gz' : 'xz'
      rv.push({
        pkg,
        type: 'bottle',
        host: {
          platform: platform as SupportedPlatform,
          arch: arch as SupportedArchitectures
        },
        compression,
        path
      })
    } else {
      rv.push({
        pkg, type: 'src', path,
        extname: path.extname(),
      })
    }
  }

  return rv
}
