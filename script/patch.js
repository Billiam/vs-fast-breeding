import { glob } from 'glob'
import json5 from 'json5'
import stringify from 'json-stable-stringify'
import StreamZip from 'node-stream-zip'
import { promises as fs } from 'node:fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { readerFromPath } from './lib/mod-reader.js'
import sortedKeys from './lib/sorted-keys.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BEHAVIOR_TARGETS = [
  'drops',
  'hoursToGrow',
  'pregnancyDays',
  'multiplyCooldownDaysMin',
  'multiplyCooldownDaysMax',
]
const MOD_PREFIXES = ['fotsa', 'lop-']
const GROUP_SETTINGS = {
  lop: 'PHANEROZOIC_CYCLE',
}

const configLibValue = (settingKey, section, value) => {
  let configValue = `round(${settingKey} * ${value})`
  const sections = section.split('/')
  if (sections.includes('hoursToGrow')) {
    configValue = `max(1, ${configValue})`
  } else if (sections.includes('multiplyCooldownDaysMin') && value === 0) {
    configValue = `greater(${settingKey}, 1.0, ceiling(${settingKey} - 1), 0)`
  } else if (sections.includes('drops')) {
    configValue = `(REDUCE_DROPS) ? min(1.0, ${settingKey}) * ${value} : ${value}`
  }
  return configValue
}

const buildPatch = (file, modId, pathSuffix, key, value, settingKey) => {
  const domain = modId ?? 'game'
  const patchPath = `/server/behaviors/${pathSuffix}${key}`
  const patch = {
    file: `${domain}:${file}`,
    op: 'replace',
    path: patchPath,
    value: Math.ceil(value * 0.5),
  }

  if (modId) {
    patch.dependsOn = [{ modId }]
  }

  patch.sortKey = `${pathSuffix.replace(/^\d+\//, '')}${key}`

  patch.configLib = configLibValue(
    settingKey ?? `${modId.toUpperCase()}_CYCLE`,
    patchPath,
    value,
  )

  return patch
}

export const filePatch = async (modId, filename, fileData, settingKey) => {
  const patchPath = filename.match(/entities.*/)[0]

  return fileData.server.behaviors.reduce(
    (patches, behavior, behaviorIndex) => {
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
              const children = drop.quantityByType
                ? Object.entries(drop.quantityByType)
                : [[null, drop.quantity]]

              children.forEach(([childKey, childValue]) => {
                const quantityPath = childKey
                  ? `${dropPrefix}/${childKey}`
                  : dropPrefix
                Object.entries(childValue).forEach(
                  ([quantityKey, quantityValue]) => {
                    if (quantityValue > 0) {
                      const patch = buildPatch(
                        patchPath,
                        modId,
                        `${suffix}${quantityPath}/`,
                        quantityKey,
                        quantityValue,
                        settingKey,
                      )
                      // remove rounding, not needed for drops
                      patch.value = quantityValue
                      patches.push(patch)
                    }
                  },
                )
              })
            })
          } else {
            patches.push(
              buildPatch(patchPath, modId, suffix, key, value, settingKey),
            )
          }
        } else if (BEHAVIOR_TARGETS.includes(keyWithoutType)) {
          Object.entries(value).forEach(([subKey, value]) => {
            patches.push(
              buildPatch(
                patchPath,
                modId,
                `${suffix}${key}/`,
                subKey,
                value,
                settingKey,
              ),
            )
          })
        }
      })

      return patches
    },
    [],
  )
}

const buildModPatch = async (modId, files, { settingKey }) => {
  // order matters when adding config lib
  const results = []
  for await (const { file, data } of files) {
    results.push(...(await filePatch(modId, file, data, settingKey)))
  }
  results.sort((a, b) => {
    return a.file.localeCompare(b.file) || a.sortKey.localeCompare(b.sortKey)
  })

  const output = {
    configLib: {},
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

export default async (
  modPath,
  { overrideModId, patchOutput, settingKey } = {},
) => {
  const readerType = readerFromPath(modPath)
  const reader = new readerType(modPath, overrideModId)

  const modId = await reader.modId

  let patchProjectPath
  if (modId) {
    const modDirectory = path.basename(modPath).toLowerCase()
    const prefix = MOD_PREFIXES.find((str) =>
      modDirectory.startsWith(str),
    )?.replace(/-$/, '')
    settingKey ??= GROUP_SETTINGS[prefix]

    patchProjectPath = `compatibility/${prefix ? prefix + '/' : ''}${modId}.json`
  } else {
    patchProjectPath = `${patchOutput}`
  }

  const patchData = await buildModPatch(modId, reader.files(), { settingKey })
  await reader.cleanup()

  const patchPath = path.resolve(
    __dirname,
    `../src/assets/fastbreeding/patches/${patchProjectPath}`,
  )

  await fs.mkdir(path.dirname(patchPath), { recursive: true })
  if (patchData.patches.length > 0) {
    await fs.writeFile(
      patchPath,
      stringify(patchData.patches, { cmp: sortedKeys, space: '  ' }) + '\n',
    )
  } else {
    await fs.rm(patchPath, { force: true })
  }

  const configLibFile = path.resolve(
    __dirname,
    '../src/assets/fastbreeding/config/configlib-patches.json',
  )
  const configLibData = JSON.parse(await fs.readFile(configLibFile, 'utf8'))

  const outputKey = `fastbreeding:patches/${patchProjectPath}`
  if (Object.keys(patchData.configLib).length > 0) {
    configLibData.patches.integer[outputKey] = patchData.configLib
  } else {
    delete configLibData.patches.integer[outputKey]
  }

  return fs.writeFile(
    configLibFile,
    stringify(configLibData, { cmp: sortedKeys, space: '  ' }) + '\n',
  )
}
