module.exports = (mikser, config) => {
    let transform = mikser.plugins.images.transform(config.source, config.destination)

    for(let action of config.config.actions) {
        if( typeof transform.imageInfo[action.action] == 'function' ) {
            transform.imageInfo[action.action].apply(transform.imageInfo, action.parameters)
        } else {
            return Promise.reject('Images Method not found', action.action)
        }
    }

    //DIRTY FIX SET original destination, as the plugin modifies it wrongly
    transform.imageInfo.destination = config.destination
    return transform.process()
}