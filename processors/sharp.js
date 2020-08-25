const sharp = require('sharp')
const fs = require('fs-extra')
const path = require('path')

module.exports = (mikser, config) => {

    const sourcemdate = fs.statSync(config.source).mtime
    if(fs.existsSync(config.destination)) {
        if( sourcemdate.getTime() == fs.statSync(config.destination).mtime.getTime() ) return Promise.resolve()
    }
    
    let sharpStream = sharp( config.source, Object.assign({failOnError: false}, config.config.options) )

    for(let action of config.config.actions) {
        if( typeof sharpStream[action.action] == 'function' ) {
            sharpStream[action.action].apply(sharpStream, action.parameters)
        } else {
            return Promise.reject('Sharp Method not found', action.action)
        }
    }
    
    fs.ensureDirSync( path.parse(config.destination).dir )
    return sharpStream.toFile(config.destination)
        .then(() => fs.utimesSync(config.destination, new Date(), sourcemdate) )
        .then(() => console.log('Image:', config.destination))
}