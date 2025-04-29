import { promises as fs } from 'node:fs'
import path from 'path'
import json5 from 'json5'
import { glob } from 'glob'
import { fileURLToPath } from 'url'
import stringify from 'json-stable-stringify'
import StreamZip from 'node-stream-zip'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BEHAVIOR_TARGETS = ['drops', 'hoursToGrow', 'pregnancyDays', 'multiplyCooldownDaysMin', 'multiplyCooldownDaysMax']
const MOD_PREFIXES = ['fotsa']

const configLibValue = (settingKey, section, value) => {
  let configValue = `round(${settingKey} * ${value})`
  if (section.includes('hoursToGrow')) {
    configValue = `max(1, ${configValue})`
  } else if (section.includes('multiplyCooldownDaysMin') && value === 0) {
    configValue = `greater(${settingKey}, 1.0, ceiling(${settingKey} - 1), 0)`
  } else if (section.startsWith('drops')) {
    configValue = `(REDUCE_DROPS) ? min(1.0, ${settingKey}) * ${value} : ${value}`
  }
  return configValue
}

const buildPatch = (file, modId, pathSuffix, key, value, settingKey) => {
  const domain = modId ?? 'game'

  const patch = {
    file: `${domain}:${file}`,
    op: 'replace',
    path: `/server/behaviors/${pathSuffix}${key}`,
    value: Math.ceil(value * 0.5)
  }

  if (modId) {
    patch.dependsOn = [{ modId }]
  }

  patch.sortKey = `${pathSuffix.replace(/^\d+\//, '')}${key}`

  patch.configLib = configLibValue(settingKey ?? `${modId.toUpperCase()}_CYCLE`, pathSuffix, value)

  return patch
}

export const filePatch = async (modId, filename, fileData, settingKey) => {
  const patchPath = filename.match(/entities.*/)[0]

  return fileData.server.behaviors.reduce((patches, behavior, behaviorIndex) => {
    const suffix = `${behaviorIndex}/`

    Object.entries(behavior).forEach(([key, value]) => {
      const keyWithoutType = key.replace(/ByType$/, '')

      if (BEHAVIOR_TARGETS.includes(key)) {
        if (key === 'drops') {
          value.forEach((drop, dropIndex) => {
            if (!drop.quantity && !drop.quantityByType) {
              // missing section block in one config file (`hooved/goat.json`) in VS 1.2.9
              return
            }
            const dropPrefix = `${key}/${dropIndex}/${drop.quantityByType ? 'quantityByType' : 'quantity'}`
            const children = drop.quantityByType ? Object.entries(drop.quantityByType) : [[null, drop.quantity]]

            children.forEach(([childKey, childValue]) => {
              const quantityPath = childKey ? `${dropPrefix}/${childKey}` : dropPrefix
              Object.entries(childValue).forEach(([quantityKey, quantityValue]) => {
                if (quantityValue > 0) {
                  const patch = buildPatch(patchPath, modId, `${suffix}${quantityPath}/`, quantityKey, quantityValue, settingKey)
                  // remove rounding, not needed for drops
                  patch.value = quantityValue
                  patches.push(patch)
                }
              })
            })
          })
        } else {
          patches.push(buildPatch(patchPath, modId, suffix, key, value, settingKey))
        }
      } else if (BEHAVIOR_TARGETS.includes(keyWithoutType)) {
        Object.entries(value).forEach(([subKey, value]) => {
          patches.push(buildPatch(patchPath, modId, `${suffix}${key}/`, subKey, value, settingKey))
        })
      }
    })

    return patches
  }, [])
}

const buildModPatch = async (modId, files, { settingKey }) => {
  // order matters when adding config lib
  const results = []
  for await (const { file, data } of files) {
    results.push(...await filePatch(modId, file, data, settingKey))
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
      this._modPromise = new Promise(async (resolve, reject) => {
        const fileData = await fs.readFile(path.join(this.path, 'modinfo.json'), 'utf8')
        const modId = json5.parse(fileData).modid
        if (modId) {
          resolve(modId)
        } else {
          reject(modId)
        }
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

  cleanup () {}
}

class PathReader {
  constructor (paths, modId) {
    this.paths = paths
    this.modid = modId
  }

  async * files () {
    for (const file of this.paths) {
      yield {
        file,
        data: json5.parse(await fs.readFile(file, 'utf8'))
      }
    }
  }

  cleanup () {}
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
      this._modPromise = new Promise(async (resolve, reject) => {
        const buffer = await this.zipFile.entryData('modinfo.json')
        const manifest = buffer.toString()
        const modId = json5.parse(manifest).modid
        if (modId) {
          resolve(modId)
        } else {
          reject()
        }
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

const getReaderType = modPath => {
  if (Array.isArray(modPath)) {
    return PathReader
  } else if (modPath.endsWith('.zip')) {
    return ZipModReader
  } else {
    return DirectoryModReader
  }
}

export default async (modPath, { overrideModId, patchOutput, settingKey } = {}) => {
  const readerType = getReaderType(modPath, overrideModId)
  const reader = new readerType(modPath, overrideModId)

  const modId = await reader.modId

  let patchProjectPath
  if (modId) {
    const modDirectory = path.basename(modPath).toLowerCase()
    const prefix = MOD_PREFIXES.find(str =>
      modDirectory.startsWith(str)
    )
    patchProjectPath = `compatibility/${prefix ? prefix + '/' : ''}${modId}.json`
  } else {
    patchProjectPath = `${patchOutput}`
  }

  const patchData = await buildModPatch(modId, reader.files(), { settingKey })
  await reader.cleanup()

  const patchPath = path.resolve(__dirname, `../src/assets/fastbreeding/patches/${patchProjectPath}`)

  await fs.writeFile(patchPath, stringify(patchData.patches, { cmp: sortedKeys, space: '  ' }) + '\n')

  const configLibFile = path.resolve(__dirname, '../src/assets/fastbreeding/config/configlib-patches.json')
  const configLibData = JSON.parse(await fs.readFile(configLibFile, 'utf8'))

  const outputKey = `fastbreeding:patches/${patchProjectPath}`
  configLibData.patches.integer[outputKey] = patchData.configLib

  return fs.writeFile(configLibFile, stringify(configLibData, { cmp: sortedKeys, space: '  ' }) + '\n')
}
