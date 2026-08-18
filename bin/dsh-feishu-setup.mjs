#!/usr/bin/env node
import('../lib/setup.js')
  .then((m) => m.main(process.argv.slice(2)))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
