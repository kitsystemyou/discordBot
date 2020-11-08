const ytdl = require("ytdl-core");

class Music {
    constructor() {
        this.dispatcher = null
        this.voice_connection = null
    }

    async stream(youtube_url) {
        const stream = ytdl(ytdl.getURLVideoID(youtube_url), { filter: 'audioonly' })
        return stream
    }

    async play(voice_connection, youtube_url, option={loop: false}) {
        let stream
        this.voice_connection = voice_connection

        try{
            stream = await this.stream(youtube_url)
        }catch(e) {
            voice_connection.disconnect()
            throw "Invalid youtube url."
        }

        try{
            this.dispatcher = voice_connection.playStream(stream, {highWaterMark: 6, bitrate: 'auto'});
        }catch(e) {
            voice_connection.disconnect()
            throw e
        }

        if(option.loop) {
            this.dispatcher.on('end', () => {
                this.play(voice_connection, youtube_url, option={is_loop: true})
            });
        }else{
            this.dispatcher.on('end', () => {
                this.voice_connection.disconnect()
            });
        }
    }

    async stop() {
        if(this.voice_connection)
            this.voice_connection.disconnect()
    }
}

module.exports = Music