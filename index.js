'use strict'
const path = require('path')
const fs = require('fs')
const _ = require('lodash')
const Promise = require('bluebird')
const jp = require('jsonpath')
const shortHash = require('shorthash2')

const processors = {
	default: require('./processors/sharp'),
	sharp: require('./processors/sharp'),
	images: require('./processors/images'),
	videos: require('./processors/videos'),
}

function lookupFile(mikser, filePath) {
	const possibleFilePaths = _.flatten([
		path.join(mikser.options.workingFolder, 'files', filePath),
		mikser.config.shared.map((shared) => path.join(mikser.options.workingFolder, 'shared', shared, filePath)),
	])

	for (let fullPath of possibleFilePaths) {
		if (fs.existsSync(fullPath)) return fullPath
	}

	mikser.diagnostics.log('warning', 'Process Assets Plugin: File not found', filePath)
}

module.exports = function(mikser) {
	mikser.diagnostics.log('info', 'Process Assets Plugin loaded.', mikser.config.shared)

	mikser.on('mikser.manager.importDocument', async (document) => {
		let layouts = []
		let _documentLayout = document
		while (_documentLayout) {
			if (_documentLayout.meta.layout) {
				layouts.push(_documentLayout.meta.layout)
			}
			_documentLayout = await mikser.database.findLayout({ _id: _documentLayout.meta.layout })
		}
		let config = mikser.config.assets || {}

		delete require.cache[require.resolve(path.join(mikser.options.workingFolder, config.preset || 'assets.config'))]
		let preset = _.cloneDeep(require(path.join(mikser.options.workingFolder, config.preset || 'assets.config')))

		let types = []
		for (let item of preset) {
			if (new RegExp(item.lookup).test(document.meta.href) || layouts.indexOf(item.lookup) != -1) {
				types.push(item.paths)
			}
		}
		if (!types.length) return Promise.resolve()

		//TODO: IMPLEMENT STAGES CYCLE -> assign stage, GROUP BY STAGE, run the rest in order

		//CREATE CONFIGS
		let actionConfigs = []
		for (let type of types) {
			for (let path in type) {
				for (let configItem of [].concat(type[path])) {
					let itemKey = path.split('.').pop()
					let results = jp.nodes(document, path)
					.filter((node) => node.path.join('.').indexOf('Assets.') == -1)
					.map((node) => {
						const key = itemKey
						let object = jp.parent(document, node.path.join('.'))
						const files = [].concat(object[key])
						const configSnapshot = _.cloneDeep(configItem)
						const resultType = _.isArray(object[key]) ? 'array' : 'string'
						const resultKey = key + 'Assets'
						object[resultKey] = object[resultKey] || { original: object[key] }
						if (!object[resultKey][configSnapshot.property])
							object[resultKey][configSnapshot.property] = _.isArray(object[key]) ? [] : ''

						return files.map((file, index) => ({
							key,
							object,
							file,
							source: lookupFile(mikser, file),
							config: configSnapshot,
							resultKey,
							resultType,
							index
						}))
					})

					actionConfigs = actionConfigs.concat(results)
				}
			}
		}
		actionConfigs = _.flatten(actionConfigs)
		//.filter(actionConfig => actionConfig.fullPath) PERHAPS DON'T DO THAT AT THIS MOMENT

		//PREPROCESS CONFIGS
		actionConfigs.forEach((actionConfig) => {
			if (_.isPlainObject(actionConfig.config.actions)) {
				actionConfig.config.actions = Object.keys(actionConfig.config.actions).map((key) => ({
					action: key,
					parameters: actionConfig.config.actions[key],
				}))
			}
			let destination = path.parse(actionConfig.file)
			delete destination.base
			destination.ext = '.' + (actionConfig.config.format || destination.ext.replace('.', ''))
			
			for (let action of actionConfig.config.actions) {
				action.parameters = action.parameters.map((param) => {
					if (_.isFunction(param)) return param(actionConfig)
					return param
				})
				destination.name += '-' + _.kebabCase(action.action)
				if (action.parameters.length) {
					destination.name += '-' + _.kebabCase(action.parameters.map(param => {
						if (_.isObject(param)) return shortHash(JSON.stringify(param))
						return param
					}).join(' '))
				}
			}
			
			destination = path.format(destination)
			actionConfig.result = destination = path.join(
				'/',
				document.meta.domain || '',
				config.destination || 'storage',
				document._id.replace(document.meta.domain || '', '')
				.split('.')
				.slice(0, -1)
				.join('.'),
				destination
			)
				
			if (!actionConfig.config.cache) {
				actionConfig.destination = path.join(mikser.config.outputFolder, destination)
			} else {
				actionConfig.destination = path.join(mikser.options.workingFolder, 'cache', destination)
			}
		})

		//PROCESS CONFIGS
		// let concurrency = _.values(_.mapValues(_.groupBy(actionConfigs, 'destination'), 'length')).find((v) => v > 1)
		// ? 1
		// : Infinity
		let concurrency = 1
		return Promise.map(
			actionConfigs,
			async (actionConfig) => {
				if (!actionConfig.source) return actionConfig			
				if (actionConfig.resultType == 'string') {
					actionConfig.object[actionConfig.resultKey][actionConfig.config.property] = actionConfig.result
				} else if (actionConfig.resultType == 'array') {
				actionConfig.object[actionConfig.resultKey][actionConfig.config.property][actionConfig.index] = actionConfig.result
			}
			
			let cacheDestination = actionConfig.destination.replace(
				path.join(mikser.options.workingFolder, 'cache'), 
				mikser.config.outputFolder
			)

			let caching = mikser.plugins.caching.cache(actionConfig.destination, cacheDestination)
			if (actionConfig.config.cache && !caching.cacheInfo.fromCache && fs.existsSync(actionConfig.destination)) {
				console.log('👜', actionConfig.destination.replace(mikser.options.workingFolder, ''))
				return caching.process().then(() => actionConfig).catch((err) => {
					mikser.diagnostics.log('warning', err)
				})
			}
			
			const processor = processors[actionConfig.config.processor] || processors['default']
			return processor(mikser, _.pick(actionConfig, ['source', 'destination', 'config.actions']))
			.then(() => {
				if (actionConfig.config.cache) {
						return caching.process()
					}
				})
				.then(() => actionConfig)
				.catch((err) => {
					mikser.diagnostics.log('warning', err)
				})
			},
			{ concurrency }
		)
	})
}
		
