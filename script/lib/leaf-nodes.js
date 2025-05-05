const isIterable = (obj) => typeof obj === 'object' || Array.isArray(obj)

export const leafNodes = (data, parentPath) => {
  if (!data) {
    return []
  }
  return Object.entries(data).flatMap(([key, value]) => {
    const childPath = `${parentPath}/${key}`

    if (isIterable(value)) {
      return leafNodes(value, childPath)
    } else {
      return { value, path: childPath, key, parent: data }
    }
  })
}

export const filterLeafNodes = (data, path, filters) => {
  const nodes = leafNodes(data, path ?? '')
  return nodes.filter((node) =>
    filters.find((regex) => {
      return regex.test(node.path)
    }),
  )
}
