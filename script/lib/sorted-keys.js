export default (a, b) => {
  const aNumeric = a.key.search(/\D/)
  const bNumeric = b.key.search(/\D/)

  if (aNumeric > 0 && bNumeric > 0) {
    return (
      Number(a.key.slice(0, aNumeric)) - Number(b.key.slice(0, bNumeric)) ||
      a.key.slice(aNumeric).localeCompare(b.key.slice(bNumeric))
    )
  }
  return a.key.localeCompare(b.key)
}
