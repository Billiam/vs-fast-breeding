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

const MOD_PREFIXES = ['fotsa', 'lop-']
const GROUP_SETTINGS = {
  lop: 'PHANEROZOIC_CYCLE',
}
const BEHAVIOR_PREFIXES = ['/server/behaviors/*', '/server/behaviorConfigs']
const BEHAVIOR_PATHS = [
  '/drops/*/quantity/avg',
  '/drops/*/quantity/var',
  '/drops/*/quantityByType/*/avg',
  '/drops/*/quantityByType/*/var',

  '/dropsByType/*/quantity/avg',
  '/dropsByType/*/quantity/var',
  '/dropsByType/*/quantityByType/*/avg',
  '/dropsByType/*/quantityByType/*/var',

  '/multiplyCooldownDaysMin',
  '/multiplyCooldownDaysMax',
  '/pregnancyDays',
  '/hoursToGrow',
]

const BEHAVIOR_PATH_REGEX = BEHAVIOR_PREFIXES.flatMap((behavior_prefix) => {
  return BEHAVIOR_PATHS.map((behavior_path) => {
    const fullPath = `${behavior_prefix}${behavior_path}`
    return new RegExp(fullPath.replaceAll('*', '[^/]+'), 'i')
  })
})

const configLibValue = (settingKey, section, value) => {
  let configValue = `round(${settingKey} * ${value})`
  const sections = section.split('/')
  if (sections.includes('hoursToGrow')) {
    configValue = `max(1, ${configValue})`
  } else if (sections.includes('multiplyCooldownDaysMin') && value === 0) {
    configValue = `greater(${settingKey}, 1.0, ceiling(${settingKey} - 1), 0)`
  } else if (sections.includes('drops') || section.includes('dropsByType')) {
    configValue = `(REDUCE_DROPS) ? min(1.0, ${settingKey}) * ${value} : ${value}`
  }
  return configValue
}

const buildPatch = (file, modId, fullPath, value, settingKey) => {
  const domain = modId ?? 'game'

  let patchValue = value * 0.5
  if (fullPath.includes('/drops')) {
    if (value === 0) {
      // no need to reduce drops which are already average or variance of zero
      return
    }
  } else {
    patchValue = Math.ceil(patchValue)
  }
  const patch = {
    file: `${domain}:${file}`,
    op: 'replace',
    path: fullPath,
    value: patchValue,
  }

  if (modId) {
    patch.dependsOn = [{ modId }]
  }

  patch.sortKey = fullPath.replace(/\/\d+\//, '/', 1)

  patch.configLib = configLibValue(
    settingKey ?? `${modId.toUpperCase()}_CYCLE`,
    fullPath,
    value,
  )

  return patch
}

const leafNodes = (data, parentPath) => {
  if (!data) {
    return []
  }
  return Object.entries(data).flatMap(([key, value]) => {
    const childPath = `${parentPath}/${key}`

    if (typeof value === 'object' || Array.isArray(value)) {
      return leafNodes(value, childPath)
    } else {
      return { value, path: childPath, key, parent: data }
    }
  })
}

const filterLeafNodes = (data, path, filters) => {
  const nodes = leafNodes(data, path ?? '')
  return nodes.filter((node) => filters.find((regex) => regex.test(node.path)))
}

export const filePatch = async (modId, filename, fileData, settingKey) => {
  const entityPath = filename.match(/entities.*/)[0]
  const nodesToPatch = filterLeafNodes(
    fileData.server,
    '/server',
    BEHAVIOR_PATH_REGEX,
  )
  return nodesToPatch
    .map((node) =>
      buildPatch(entityPath, modId, node.path, node.value, settingKey),
    )
    .filter(Boolean)
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
    const modPrefix = MOD_PREFIXES.find((str) =>
      modDirectory.startsWith(str),
    )?.replace(/-$/, '')
    settingKey ??= GROUP_SETTINGS[modPrefix]

    patchProjectPath = `compatibility/${modPrefix ? modPrefix + '/' : ''}${modId}.json`
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
