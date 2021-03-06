'use strict'

const path = require('path')

function reqlib () {
  const args = [].concat([__dirname, 'lib'], Array.from(arguments))
  return require(path.join.apply(null, args))
}

const configPath = reqlib('cli')
let config = configPath || './settings.js'
try {
  const fp = path.resolve(config)
  config = require(fp)
} catch (e) {
  console.error('could not load configuration: %s', e.message)
  process.exit(1)
}
const log = reqlib('logger')(config)

const opbeat = require('opbeat')
if (config.opbeat) {
  const opbeatConfig = (typeof config.opbeat === 'object')
    ? Object.assign({}, config.opbeat, {logger: log})
    : {logger: log}
  opbeat.start(opbeatConfig)
} else {
  opbeat.start({active: false, logLevel: 'fatal'})
}
log.info('OpBeat client activated: %s', opbeat.active)

const introduce = require('introduce')(__dirname)
const ioc = require('laic').laic.addNamespace('casServer')
ioc.register('config', config, false)
ioc.register('opbeat', opbeat, false)
ioc.addNamespace('lib').register('logger', log, false)

introduce('lib/loadDataSources').then((dataSources) => {
  ioc.register('dataSources', dataSources, false)

  // phase one plugins must be initialized immediately after loading the
  // configuration and logger, otherwise dependent parts will not have
  // access to them
  const pluginsLoader = introduce('lib/pluginsLoader')
  const phase1 = pluginsLoader.phase1()
  ioc.register('plugins', phase1, false)

  const hooks = {
    userAttributes: {},
    preAuth: {}
  }
  ioc.register('hooks', hooks, false)

  log.debug('loading Hapi web server')
  const server = introduce('lib/loadServer')()
  ioc.register('server', server, false)
  server.start(function startServerCB (error) {
    if (error) {
      log.error('could not start web server: %s', error.message)
      log.debug(error.stack)
      process.exit(1)
    }
    log.debug('web server started')
    log.info('web server address: %s', server.info.uri)
    reqlib('processManagement')

    setImmediate(() => pluginsLoader.phase2(server, hooks))
    setImmediate(() => process.send && process.send('ready'))
  })
}).catch(function (err) {
  log.error('could not load datasources: %s', err.message)
  log.debug(err.stack)
  process.exit(1)
})
