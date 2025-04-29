#!/usr/bin/env node
import { fileURLToPath } from 'url'
import path from 'path'
import { promises as fs, existsSync, createWriteStream } from 'fs'
import semver from 'semver'
import patch from './patch.js'
import stringify from 'json-stable-stringify'

import { Readable } from 'node:stream'
import { finished } from 'stream/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const options = process.argv.slice(2).filter(arg => arg.startsWith('--'))

const opts = options.reduce((list, option) => {
  const parsed = option.match(/^--([^=]+)(?:=(.*))?/)
  list[parsed[1]] = parsed[2] === '' || parsed[2] == null ? true : parsed[2]
  return list
}, {})

const downloadZip = async (url, filename) => {
  console.log('Fetching', url)
  const tmpDirPath = path.resolve(__dirname, '../tmp')

  const destination = path.join(tmpDirPath, filename)
  if (existsSync(destination)) {
    return destination
  }

  if (!existsSync(tmpDirPath)) {
    await fs.mkdir(tmpDirPath)
  }

  const res = await fetch(url, { redirect: 'follow' })

  const fileStream = createWriteStream(destination, { flags: 'w' })
  await finished(Readable.fromWeb(res.body).pipe(fileStream))

  return destination
}

const updateMod = async (modId, lastVersion) => {
  console.log('Updating', modId)
  const response = await fetch(`https://mods.vintagestory.at/api/mod/${modId}`, { redirect: 'follow' })
  const data = await response.json()

  if (data.statuscode === '200') {
    const latestRelease = data.mod.releases[0]
    const releaseNewer = !lastVersion || semver.gt(latestRelease.modversion, lastVersion)

    if (releaseNewer) {
      console.log('Fetching newer release', `${latestRelease.modversion} > ${lastVersion}`)
      const zipPath = await downloadZip(latestRelease.mainfile, latestRelease.filename)
      await patch(zipPath)

      return latestRelease.modversion
    }
  }
}

(async () => {
  const modsConfigPath = path.join(__dirname, '../mods.json')
  const modVersions = JSON.parse(await fs.readFile(modsConfigPath, 'utf8'))

  const modIds = Object.keys(modVersions.mods)
  for (const modId of modIds) {
    //TODO: limit updates to targeted VS versions
    const lastVersion = opts.force ? null : modVersions.mods[modId]
    const newVersion = await updateMod(modId, lastVersion)
    if (newVersion) {
      modVersions.mods[modId] = newVersion
    }
  }

  return fs.writeFile(modsConfigPath, stringify(modVersions, { space: '  ' }) + '\n')
})()
