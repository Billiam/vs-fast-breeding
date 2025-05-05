import { promises as fs } from 'fs'
import { glob } from 'glob'
import { EvalAstFactory, parse } from 'jexpr'
import configData from 'src/assets/fastbreeding/config/configlib-patches.json' with { type: 'json' }
import lang from 'src/assets/fastbreeding/lang/en.json' with { type: 'json' }
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

  const referencedKeys = Object.values(configData.patches)
    .map((patchedFiles) => {
      return Object.values(patchedFiles).map((patchList) => {
        return Object.values(patchList).map((patchExpression) => {
          const expr = parse(patchExpression, astFactory)
          return collectVariables(expr)
        })
      })
    })
    .flat(5)

  const existingSettings = Object.keys(allSettings(configData.settings))

  const uniqueKeys = new Set(referencedKeys)

  for (const key of uniqueKeys) {
    expect(existingSettings).toContain(key)
  }
})

test('config keys are translated', async () => {
  const existingSettings = Object.values(allSettings(configData.settings))

  for (const setting of existingSettings) {
    expect(lang).toHaveProperty(setting.comment)
    expect(lang).toHaveProperty(setting.name)
  }
})

test('settings are up to date', () => {})
