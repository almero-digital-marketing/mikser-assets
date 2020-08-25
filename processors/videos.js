module.exports = (mikser, config) => {
    let transform = mikser.plugins.videos.transform(config.source, config.destination)

    for(let action of config.config.actions) {
        if( typeof transform.videoInfo[action.action] == 'function' ) {
            transform.videoInfo[action.action].apply(transform.videoInfo, action.parameters)
        } else {
            return Promise.reject('Videos Method not found', action.action)
        }
    }

    //DIRTY FIX SET original destination, as the plugin modifies it wrongly)
    transform.videoInfo.destination = config.destination
    return transform.process()
}