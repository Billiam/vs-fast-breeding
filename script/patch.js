import vanillaAnimals from '../vanilla-animals.json' with { type: 'json' }
import globrex from 'globrex'
import stringify from 'json-stable-stringify'
import { promises as fs } from 'node:fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { modData } from './lib/entity-lists.js'
import { filterLeafNodes } from './lib/leaf-nodes.js'
import { readerFromPath } from './lib/mod-reader.js'
import sortedKeys from './lib/sorted-keys.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// glob for readability
const BEHAVIOR_PREFIXES = ['/server/behaviors/**', '/behaviorConfigs/**']
const BEHAVIOR_PATHS = [
  '/drops/**/quantity/avg',
  '/drops/**/quantity/var',
  '/drops/**/quantityByType/*/avg',
  '/drops/**/quantityByType/*/var',

  '/dropsByType/**/quantity/avg',
  '/dropsByType/**/quantity/var',
  '/dropsByType/**/quantityByType/*/avg',
  '/dropsByType/**/quantityByType/*/var',

  '/multiplyCooldownDaysMin',
  '/multiplyCooldownDaysMax',
  '/pregnancyDays',
  '/hoursToGrow',

  '/multiplyCooldownDaysMinByType/*',
  '/multiplyCooldownDaysMaxByType/*',
  '/pregnancyDaysByType/*',
  '/hoursToGrowByType/*',
]

const MODDED_VANILLA_CHECK_PATHS = [
  '/server/behaviors/**/portionsEatenForMultiply',
  '/server/behaviorConfigs/**/portionsEatenForMultiply',
  '/server/behaviors/**/portionsEatenForMultiplyByType/*',
  '/server/behaviorConfigs/**/portionsEatenForMultiplyByType/*',
  '/server/behaviors/**/eatTime',
  '/server/behaviorConfigs/**/eatTime',
  '/attributes/creatureDiet/**/*',
]

// convert glob to regex
const BEHAVIOR_PATH_REGEX = BEHAVIOR_PREFIXES.flatMap((behavior_prefix) => {
  return BEHAVIOR_PATHS.map((behavior_path) => {
    const fullPath = `${behavior_prefix}${behavior_path}`
    return globrex(fullPath, { globstar: true }).regex
  })
})

const VANILLA_ANIMAL_PATHS = vanillaAnimals.map((patch) => {
  const patchPathRegex = globrex(`game:entities/${patch.input}`).regex
  return {
    regex: patchPathRegex,
    settingKey: patch.key,
  }
})
const MODDED_VANILLA_CHECK_REGEX = MODDED_VANILLA_CHECK_PATHS.map(
  (checkPath) => {
    return globrex(checkPath, { globstar: true }).regex
  },
)

const cachedModPromise = () => {
  let modPromise

  return () => {
    if (!modPromise) {
      modPromise = modData()
    }
    return modPromise
  }
}
const getModData = cachedModPromise()

const configLibValue = (settingKey, section, value) => {
  let configValue = `round(${settingKey} * ${value})`
  let type = 'integer'
  const sections = section.split('/')
  const minValueKeys = ['hoursToGrow', 'pregnancyDays'].flatMap((value) => [
    value,
    `${value}ByType`,
  ])
  const dropKeys = ['drops', 'dropsByType']

  if (minValueKeys.some((key) => sections.includes(key))) {
    configValue = `max(1, ${configValue})`
  } else if (sections.includes('multiplyCooldownDaysMin') && value === 0) {
    configValue = `greater(${settingKey}, 1.0, ceiling(${settingKey} - 1), 0)`
  } else if (dropKeys.some((key) => sections.includes(key))) {
    configValue = `(REDUCE_DROPS) ? min(1.0, ${settingKey}) * ${value} : ${value}`
    type = 'float'
  }

  return {
    type,
    value: configValue,
  }
}

const getPatchValue = (value, fullPath) => {
  if (fullPath.includes('/drops')) {
    if (value === 0) {
      // no need to reduce drops which are already average or variance of zero
      return
    }
    return value * 0.5
  } else {
    return Math.ceil(value * 0.5)
  }
}

const buildPatch = (file, modId, fullPath, value, settingKey) => {
  const domain = modId ?? 'game'

  let patchValue = getPatchValue(value, fullPath)
  if (patchValue == null) {
    return
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

export const filePatch = async (modId, filename, fileData, settingKey) => {
  const entityPath = filename.match(/entities.*/)[0]
  const nodesToPatch = filterLeafNodes(fileData, '', BEHAVIOR_PATH_REGEX)
  return nodesToPatch
    .map((node) =>
      buildPatch(entityPath, modId, node.path, node.value, settingKey),
    )
    .filter(Boolean)
}

const findVanillaAnimal = (path) => {
  return VANILLA_ANIMAL_PATHS.find((knownAnimal) =>
    knownAnimal.regex.test(path),
  )
}

const getPatchSettingKey = async (patchPath) => {
  const patchDomain = patchPath.split(':')[0]
  if (patchDomain === 'game') {
    const animal = findVanillaAnimal(patchPath)
    if (!animal) {
      return
    }
    return animal.settingKey
  } else {
    //verify that mod animal is handled
    const modData = await getModData()

    const patchModId = patchDomain
    if (!modData.mods.includes(patchModId)) {
      return
    }

    const modGroup = modData.groupIndex[patchModId.toLowerCase()]

    return (
      modData.groups[modGroup]?.shareConfig ??
      `${patchModId.toUpperCase()}_CYCLE`
    )
  }
}

const buildCompatibilityPatch = async (modId, file, data) => {
  const dataCopy = structuredClone(data)

  dataCopy.forEach((patch, patchIndex) => {
    patch.index = patchIndex
  })
  const configLibPatches = {}

  let vendorPatch = false
  let lastSkip
  const patchPromises = dataCopy
    .filter(
      (patch) =>
        patch.op.startsWith('add') && patch.side?.toLowerCase() !== 'client',
    )
    .map(async (patch) => {
      // one compatibility patch item generates multiple changes + configlib items
      const settingKey = await getPatchSettingKey(patch.file)
      if (!settingKey) {
        if (patch.file !== lastSkip) {
          lastSkip = patch.file
          // console.log('Skipping', patch.file)
        }
        return
      }

      const changes = filterLeafNodes(
        patch.value,
        patch.path,
        BEHAVIOR_PATH_REGEX,
      )

      changes.forEach((filteredPatch) => {
        const patchValue = getPatchValue(
          filteredPatch.value,
          filteredPatch.path,
        )

        // need to preserve original value
        if (patchValue == null) {
          return
        }
        vendorPatch = true
        // mutate patch value
        filteredPatch.parent[filteredPatch.key] = patchValue

        const configLibPath = `${patch.index}/value${filteredPatch.path.substring(patch.path.length)}`
        // issue: not enough info here to identify drop maybe, but should be visible from original patch
        // so path passed to value should be original path
        const { type, value } = configLibValue(
          settingKey,
          filteredPatch.path,
          filteredPatch.value,
        )
        configLibPatches[type] ??= {}
        configLibPatches[type][configLibPath] = value
      })
    })

  await Promise.all(patchPromises)

  if (!vendorPatch) {
    return
  }

  const patchPrefix = `assets/${modId}/`
  if (!file.startsWith(patchPrefix)) {
    throw new Error(`Unexpected patch directory: ${file}`)
  }
  const filePathSuffix = file.substring(patchPrefix.length)
  dataCopy.forEach((patch) => {
    delete patch.index
  })

  return {
    data: dataCopy,
    outputPath: filePathSuffix,
    configLib: configLibPatches,
  }
}

const findVanillaModifications = (modId, file, data) => {
  const patches = data
    .filter(
      (patch) =>
        patch.op.startsWith('add') &&
        patch.side?.toLowerCase() !== 'client' &&
        patch.file.startsWith('game:entities'),
    )
    .filter((patch) => {
      const animal = findVanillaAnimal(patch.file)
      if (animal) {
        return
      }

      const filteredNodes = filterLeafNodes(
        patch.value,
        patch.path,
        MODDED_VANILLA_CHECK_REGEX,
      )
      if (filteredNodes.length === 0) {
        return
      }

      return path
    })

  if (patches.length) {
    return patches
  }
}

const buildModPatch = async (
  modId,
  files,
  patches,
  { settingKey, dependsOn },
) => {
  const results = []
  for await (const { file, data } of files) {
    const patches = await filePatch(modId, file, data, settingKey)
    if (dependsOn) {
      // merge dependsOn values from outside
      patches.forEach((patch) => {
        patch.dependsOn = [...(patch.dependsOn ?? []), ...dependsOn]
      })
    }

    results.push(...patches)
  }

  const output = {
    configLib: {},
    newVanillaAnimals: {},
  }

  const overridePatches = []
  for await (const { file, data } of patches) {
    const patch = await buildCompatibilityPatch(modId, file, data, settingKey)
    if (patch) {
      overridePatches.push(patch)
    }

    const vanillaPatches = await findVanillaModifications(modId, file, data)
    if (vanillaPatches) {
      output.newVanillaAnimals[modId] = {
        file,
        patches: vanillaPatches,
      }
    }
  }

  results.sort((a, b) => {
    return a.file.localeCompare(b.file) || a.sortKey.localeCompare(b.sortKey)
  })

  output.patches = results
  output.overridePatches = overridePatches

  output.patches.forEach((patch, patchIndex) => {
    const configKey = `${patchIndex}/value`

    const { type, value } = patch.configLib
    output.configLib[type] ??= {}
    output.configLib[type][configKey] = value

    delete patch.sortKey
    delete patch.configLib
  })

  output.overridePatches.forEach((patch) => {
    delete patch.index
  })

  return output
}

export default async (
  modPath,
  { overrideModId, patchOutput, settingKey, dependsOn } = {},
) => {
  const readerType = readerFromPath(modPath)
  const reader = new readerType(modPath, overrideModId)

  const modId = await reader.modId

  let patchProjectPath
  if (modId) {
    const modData = await getModData()

    const modPrefix = modData.groupIndex[modId.toLowerCase()]
    settingKey ??= modData.groups[modPrefix]?.shareConfig

    patchProjectPath = `compatibility/${modPrefix ? modPrefix + '/' : ''}${modId}.json`
  } else {
    patchProjectPath = `${patchOutput}`
  }

  const patchData = await buildModPatch(
    modId,
    reader.files(),
    reader.patches(),
    { settingKey, dependsOn },
  )
  await reader.cleanup()

  const patchOutputPath = path.resolve(
    __dirname,
    `../src/assets/fastbreeding/patches/${patchProjectPath}`,
  )

  await fs.mkdir(path.dirname(patchOutputPath), { recursive: true })
  if (patchData.patches.length > 0) {
    await fs.writeFile(
      patchOutputPath,
      stringify(patchData.patches, { cmp: sortedKeys, space: '  ' }) + '\n',
    )
  } else {
    await fs.rm(patchOutputPath, { force: true })
  }

  const configLibFile = path.resolve(
    __dirname,
    '../src/assets/fastbreeding/config/configlib-patches.json',
  )
  const configLibData = JSON.parse(await fs.readFile(configLibFile, 'utf8'))

  // clear patch override subdirectory
  if (modId) {
    const modOverrideDirectory = path.resolve(
      __dirname,
      '../src/assets/fastbreeding/compatibility',
      modId,
    )

    await fs.rm(modOverrideDirectory, { force: true, recursive: true })

    if (patchData.overridePatches.length > 0) {
      await fs.mkdir(modOverrideDirectory, { recursive: true })

      await Promise.all(
        patchData.overridePatches.map(async (override) => {
          const overridePath = path.join(
            modOverrideDirectory,
            override.outputPath,
          )
          await fs.mkdir(path.dirname(overridePath), { recursive: true })
          console.log('Writing ', overridePath)
          return fs.writeFile(
            overridePath,
            JSON.stringify(override.data, null, 2),
          )
        }),
      )
    }
  }

  const overrideOutputKey = `fastbreeding:compatibility/${modId}`
  const outputKey = `fastbreeding:patches/${patchProjectPath}`

  // remove existing keys first
  Object.values(configLibData.patches).forEach((data) => {
    Object.keys(data)
      .filter(
        (patchFile) =>
          patchFile.startsWith(overrideOutputKey) ||
          patchFile.startsWith(outputKey),
      )
      .forEach((key) => delete data[key])
  })

  Object.entries(patchData.configLib).forEach(([type, patches]) => {
    configLibData.patches[type] ??= {}
    configLibData.patches[type][outputKey] = patches
  })

  patchData.overridePatches.forEach((patchFile) => {
    Object.entries(patchFile.configLib).forEach(([type, configLib]) => {
      const configLibKey = path.join(overrideOutputKey, patchFile.outputPath)

      configLibData.patches[type] ??= {}
      configLibData.patches[type][configLibKey] = configLib
    })
  })

  Object.entries(patchData.newVanillaAnimals).forEach(
    ([modId, { file, patches }]) => {
      const fileNames = patches.map((patch) => patch.file.replace(/^game:/, ''))
      console.warn(
        `${modId} may have added breeding for files:\n${fileNames.join('\n')}`,
      )
      console.log(patches)
    },
  )

  return fs.writeFile(
    configLibFile,
    stringify(configLibData, { cmp: sortedKeys, space: '  ' }) + '\n',
  )
}
