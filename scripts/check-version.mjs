import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tauriConfig = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
)
const cargoManifest = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
const cargoVersion = cargoManifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const versions = {
  'package.json': packageJson.version,
  'src-tauri/tauri.conf.json': tauriConfig.version,
  'src-tauri/Cargo.toml': cargoVersion,
}
const uniqueVersions = new Set(Object.values(versions))

if (uniqueVersions.size !== 1 || uniqueVersions.has(undefined)) {
  console.error('Application versions do not match:', versions)
  process.exit(1)
}

const version = packageJson.version
const releaseTag = process.argv[2]
if (releaseTag && releaseTag !== `v${version}`) {
  console.error(`Release tag ${releaseTag} does not match application version v${version}`)
  process.exit(1)
}

console.log(`Application version ${version}${releaseTag ? ` matches ${releaseTag}` : ''}`)
