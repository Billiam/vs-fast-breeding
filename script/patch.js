import { promises as fs } from 'node:fs'
import path from 'path'
import json5 from 'json5'
import { glob } from 'glob'
import { fileURLToPath } from 'url'
import stringify from 'json-stable-stringify'
import StreamZip from 'node-stream-zip'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BEHAVIOR_TARGETS = ['hoursToGrow', 'pregnancyDays', 'multiplyCooldownDaysMin', 'multiplyCooldownDaysMax']
const MOD_PREFIXES = ['fotsa']

const buildPatch = (file, modId, pathSuffix, key, value) => {
  const patch = {
    file: `${modId}:${file}`,
    op: 'replace',
    path: `/server/behaviors/${pathSuffix}${key}`,
    value: Math.ceil(value * 0.5)
  }

  patch.dependsOn = [{ modId }]
  patch.sortKey = `${pathSuffix.replace(/^\d+\//, '')}${key}`

  const configLibSetting = `${modId.toUpperCase()}_CYCLE`

  let configValue = `round(${configLibSetting} * ${value})`
  if (pathSuffix.includes('hoursToGrow')) {
    configValue = `max(1, ${configValue})`
  }
  patch.configLib = configValue

  return patch
}

export const filePatch = async (modId, filename, fileData) => {
  const patchPath = filename.match(/entities.*/)[0]

  return fileData.server.behaviors.reduce((patches, behavior, behaviorIndex) => {
    const suffix = `${behaviorIndex}/`

    Object.entries(behavior).forEach(([key, value]) => {
      const keyWithoutType = key.replace(/ByType$/, '')

      if (BEHAVIOR_TARGETS.includes(key)) {
        patches.push(buildPatch(patchPath, modId, suffix, key, value))

      } else if (BEHAVIOR_TARGETS.includes(keyWithoutType)) {
        Object.entries(value).forEach(([subKey, value]) => {
          patches.push(buildPatch(patchPath, modId, `${suffix}${key}/`, subKey, value))
        })
      }
    })

    return patches
  }, [])
}

const buildModPatch = async (modId, files) => {
  // order matters when adding config lib
  const results = []
  for await (const { file, data } of files) {
    results.push(...await filePatch(modId, file, data))
  }
  results.sort((a, b) => {
    return a.file.localeCompare(b.file) || a.sortKey.localeCompare(b.sortKey)
  })

  const output = {
    configLib: {}
  }

  output.patches = results

  output.patches.forEach((patch, patchIndex) => {
    const configKey = `${patchIndex}/value`
    output.configLib[configKey] = patch.configLib
    delete patch.sortKey
    delete patch.configLib
  })

  return output
}

const sortedKeys = (a, b) => {
  const aNumeric = a.key.search(/\D/)
  const bNumeric = b.key.search(/\D/)

  if (aNumeric > 0 && bNumeric > 0) {
    return Number(a.key.slice(0, aNumeric)) - Number(b.key.slice(0, bNumeric)) || a.key.slice(aNumeric).localeCompare(b.key.slice(bNumeric))
  }
  return a.key.localeCompare(b.key)
}

class DirectoryModReader {
  constructor (path) {
    this.path = path
  }

  get modId () {
    if (!this._modPromise) {
      this._modPromise = new Promise(async resolve => {
        const fileData = await fs.readFile(path.join(this.path, 'modinfo.json'), 'utf8')
        resolve(json5.parse(fileData).modid)
      })
    }
    return this._modPromise
  }

  async * files () {
    const modId = await this.modId
    const jsonGlob = path.join(this.path, `assets/${modId}/entities/**/*.json`)
    const fileList = await glob(jsonGlob, {})
    for (const file of fileList) {
      yield {
        file,
        data: json5.parse(await fs.readFile(file, 'utf8'))
      }
    }
  }

  async cleanup () {}
}

class ZipModReader {
  constructor (path) {
    this.path = path
  }

  get zipFile () {
    if (!this.zip) {
      this.zip = new StreamZip.async({ file: this.path })
    }
    return this.zip
  }

  async cleanup () {
    if (this.zip) {
      return this.zip.close()
    }
  }

  get modId () {
    if (!this._modPromise) {
      this._modPromise = new Promise(async resolve => {
        const buffer = await this.zipFile.entryData('modinfo.json')
        const manifest = buffer.toString()
        resolve(json5.parse(manifest).modid)
      })
    }
    return this._modPromise
  }

  async * files () {
    const modId = await this.modId
    const zipFile = await this.zipFile

    const entries = await zipFile.entries()

    const fileList = Object.keys(entries).filter(filename => {
      return filename.startsWith(`assets/${modId}/entities/`) && filename.endsWith('.json')
    })

    for (const file of fileList) {
      const entry = await zipFile.entryData(file)
      yield {
        file,
        data: json5.parse(entry.toString())
      }
    }
  }
}

export default async modPath => {
  const readerType = modPath.endsWith('.zip') ? ZipModReader : DirectoryModReader
  const reader = new readerType(modPath)

  const modId = await reader.modId
  if (!modId) {
    throw new Error('mod could not be identified')
  }

  const modDirectory = path.basename(modPath).toLowerCase()
  const prefix = MOD_PREFIXES.find(str =>
    modDirectory.startsWith(str)
  )

  const patchData = await buildModPatch(modId, reader.files())
  await reader.cleanup()

  const patchProjectPath = `patches/compatibility/${prefix ? prefix + '/' : ''}${modId}.json`
  const patchPath = path.resolve(__dirname, `../src/assets/fastbreeding/${patchProjectPath}`)

  await fs.writeFile(patchPath, stringify(patchData.patches, { cmp: sortedKeys, space: '  ' }) + '\n')

  const configLibFile = path.resolve(__dirname, '../src/assets/fastbreeding/config/configlib-patches.json')
  const configLibData = JSON.parse(await fs.readFile(configLibFile, 'utf8'))

  const outputKey = `fastbreeding:${patchProjectPath}`
  configLibData.patches.integer[outputKey] = patchData.configLib

  return fs.writeFile(configLibFile, stringify(configLibData, { cmp: sortedKeys, space: '  ' }) + '\n')
}
