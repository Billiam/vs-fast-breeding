import { promises as fs } from 'fs'
import { glob } from 'glob'
import { EvalAstFactory, parse } from 'jexpr'
import { beforeAll, expect, test } from 'vitest'

const fetchFileList = () => {
  return glob('src/**/*.json')
}

let files
beforeAll(async () => {
  files = await fetchFileList()
})

test('all json files are valid', async () => {
  const fileData = files.map(async (file) => {
    return JSON.parse(await fs.readFile(file))
  })

  return expect(() => Promise.all(fileData)).not.toThrowError()
})

const collectVariables = (ast) => {
  const variables = []
  if (ast.type === 'ID') {
    variables.push(ast.value)
  }
  const recurseValues = [
    ...(ast.arguments ?? []),
    ast.condition,
    ast.trueExpr,
    ast.falseExpr,
    ast.left,
    ast.right,
  ].filter(Boolean)
  recurseValues.forEach((arg) => {
    const result = collectVariables(arg)
    if (result) {
      variables.push(...result)
    }
  })

  return variables
}

const allSettings = (settings) => {
  return Object.values(settings).reduce(
    (result, typedSetting) => ({ ...typedSetting, ...result }),
    {},
  )
}

test('config settings are referenced', async () => {
  const astFactory = new EvalAstFactory()

  const configData = JSON.parse(
    await fs.readFile('src/assets/fastbreeding/config/configlib-patches.json'),
  )

  const referencedKeys = Object.values(configData.patches).map(
    (patchedFiles) => {
      return Object.values(patchedFiles).map((patchList) => {
        return Object.values(patchList).map((patchExpression) => {
          const expr = parse(patchExpression, astFactory)
          return collectVariables(expr)
        })
      })
    },
  )

  const existingSettings = allSettings(configData.settings)
  const uniqueKeys = new Set(referencedKeys.flat(1000))
  for (const key of uniqueKeys) {
    expect(existingSettings[key]).toBeTruthy()
  }
})

test('config keys are translated', async () => {
  const configData = JSON.parse(
    await fs.readFile('src/assets/fastbreeding/config/configlib-patches.json'),
  )
  const existingSettings = allSettings(configData.settings)
  const translations = JSON.parse(
    await fs.readFile('src/assets/fastbreeding/lang/en.json'),
  )
  Object.values(existingSettings).forEach((setting) => {
    if (setting.comment) {
      expect(translations[setting.comment]).toBeTruthy()
    }
    expect(translations[setting.name]).toBeTruthy()
  })
})

test('settings are up to date', () => {})
