import { promises as fs } from 'node:fs'
import path from 'path'
import json5 from 'json5'
import { glob } from 'glob'
import { fileURLToPath } from 'url'
import stringify from 'json-stable-stringify'

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

const buildModPatch = async (modId, files) => {
  // order matters when adding config lib

  const results = (await Promise.all(files.map(async file => {
    const patches = []
    const patchPath = file.match(/entities.*/)[0]

    const data = json5.parse(await fs.readFile(file, 'utf8'))

    data.server.behaviors.forEach((behavior, behaviorIndex) => {
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
    })

    return patches
  }))).flat()

  const output = {
    configLib: {}
  }
  results.sort((a, b) => {
    return a.file.localeCompare(b.file) || a.sortKey.localeCompare(b.sortKey)
  })
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
export default async modPath => {
  const modInfoPath = path.join(modPath, 'modinfo.json')
  const modId = json5.parse(await fs.readFile(modInfoPath, 'utf8')).modid

  if (!modId) {
    throw new Error('mod could not be identified')
  }

  const modDirectory = path.basename(modPath).toLowerCase()
  const prefix = MOD_PREFIXES.find(str =>
    modDirectory.startsWith(str)
  )

  const jsonGlob = path.join(modPath, `assets/${modId}/entities/**/*.json`)

  const fileList = await glob(jsonGlob, {})

  const patchData = await buildModPatch(modId, fileList)
  const patchProjectPath = `patches/compatibility/${prefix ? prefix + '/' : ''}${modId}.json`
  const patchPath = path.resolve(__dirname, `../src/assets/fastbreeding/${patchProjectPath}`)

  await fs.writeFile(patchPath, stringify(patchData.patches, { cmp: sortedKeys, space: '  ' }))

  const configLibFile = path.resolve(__dirname, '../src/assets/fastbreeding/config/configlib-patches.json')
  const configLibData = JSON.parse(await fs.readFile(configLibFile, 'utf8'))

  const outputKey = `fastbreeding:${patchProjectPath}`
  configLibData.patches.integer[outputKey] = patchData.configLib

  return fs.writeFile(configLibFile, stringify(configLibData, { cmp: sortedKeys, space: '  ' }))
}
