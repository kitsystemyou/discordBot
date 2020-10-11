const twitterAPI = require('twitter');
const config = require("../config.json")

class TwitterPipeline {
    constructor(discord_client, error_handler=(channel_id, err) => {console.log(err)}) {
        this.discord_client = discord_client
        this.speech = new (require("./speech.js"))(discord_client)
        this.db = require("./database.js").load(config.data_path.twitter_pipeline)
        this.twitter_client = new twitterAPI({
            consumer_key: process.env.TWITTER_CONSUMER_KEY,
            consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
            access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
            access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
        })
        this.error_handler = error_handler
        this.tweet_url = "https://twitter.com/<screen_name>/status/<tweet_id>"
        this.tweet_stream = null
        this.user_channel_id_map = {}
        this.retry_wait_msec = 1000
    }

    async syncDB() {
        return new Promise(async (resolve, reject) => {
            // 現状されているパイプラインを解除
            await this.stop()

            // DBから読み込んでパイプライン設定
            this.db.find({}, async (err, saved_pipelines) => {
                if(err) reject(err)

                if(saved_pipelines.length > 0) {
                    // user_idとchannel_idを紐付けるmap
                    const user_channel_id_map = {}
                    for(let pipeline of saved_pipelines) {
                        user_channel_id_map[pipeline.user.id] = pipeline.channel_id
                    }

                    resolve(this.create(user_channel_id_map))
                }else resolve(false)
            })
        })
    }

    // user_idとchannel_idのマップを元にパイプライン作成
    async create(user_channel_id_map, is_retry=false) {
        // すでにパイプラインが設定されていた場合
        if(this.tweet_stream) this.stop()

        const twitter_users_id = Object.keys(user_channel_id_map)
        if(twitter_users_id.length === 0) throw "Can't create empty pipeline"

        this.tweet_stream = this.twitter_client.stream('statuses/filter', { follow: twitter_users_id.join(",") })
        this.tweet_stream.on('data', tweet => {
            this.retry_wait_msec = 1000 // APIリトライ待機時間をリセット
            const channel_id = user_channel_id_map[tweet.user.id_str]
            const tweet_url = this.tweet_url
                .replace("<screen_name>", tweet.user.screen_name)
                .replace("<tweet_id>", tweet.id_str)

            this.speech.msg(channel_id, tweet_url)
        })

        this.user_channel_id_map = user_channel_id_map

        // エラーログを流すチャンネル、取り敢えずPipeline[0]のチャンネルで
        const error_log_channel_id = user_channel_id_map[twitter_users_id[0]]
        this.tweet_stream.on('error', err => {
            // 420: APIのレート制限
            if(err.message === "Status Code: 420") {
                // 1回目のAPIリトライの場合
                if(!is_retry) {
                    this.speech.msg(error_log_channel_id, config.messages.twitter_pipeline_retry)
                }

                // リトライ待機時間が一時間以上まで伸びていたらエラー
                if(this.retry_wait_msec > 3600 * 1000) {
                    this.error_handler(error_log_channel_id, "API retry timeout.")
                }else{
                    // リトライ設定
                    setTimeout(() => {
                        this.create(user_channel_id_map, is_retry=true)
                    }, this.retry_wait_msec *= 2) // APIリトライする度に待機時間を1s->2s->4s->3600sと伸ばしていく
                    console.log(`APIリトライ: ${this.retry_wait_msec / 1000}s`)
                }

            }else if(err.message !== "Unexpected token E in JSON at position 0"){
                this.error_handler(error_log_channel_id, err)
            }
        })
    }

    async stop() {
        return this.tweet_stream ? this.tweet_stream.destroy() : false
    }

    async delete(twitter_user_id) {
        return new Promise((resolve, reject) => {
            this.db.remove({"user.id": twitter_user_id}, {}, (err, removed_count) => {
                if(err) reject(err)
                resolve(removed_count)
            })
        }).then(async removed_count => {
            await this.db.persistence.compactDatafile()
            return removed_count
        }).then(async removed_count => {
            await this.syncDB()
            return removed_count
        })
    }

    async add(channel_id, twitter_user_id) {
        return new Promise((resolve, reject) => {
            this.db.count({}, async (err, count) => {
                if(err) reject(err)
                else if(count >= config.twitter_pipeline_limit) {
                    reject(`Twitter pipeline limit.`)
                }else{
                    resolve(this.getUserFromId(twitter_user_id))
                }
            })
        }).then(twitter_user => {
            return new Promise((resolve, reject) => {
                this.db.find({ "user.id": twitter_user_id }, (err, records) => {
                    if(err) reject(err)
                    else if(records.length > 0) reject("Twitter pipeline duplicate.")
                    else resolve(twitter_user)
                })
            })
        }).then(twitter_user => {
            return new Promise((resolve, reject) => {
                this.db.insert({
                    channel_id: channel_id,
                    user: {
                        id: twitter_user_id,
                    }
                }, (err, inserted) => {
                    if(err) reject(err)
                    else resolve(inserted)
                })
            })
        }).then(async inserted => {
            return this.syncDB()
        })
    }

    async getUserFromId(twitter_user_id) {
        return new Promise((resolve, reject) => {
            this.twitter_client.get('users/show', {user_id: twitter_user_id}, (err, user, response) => {
                if(err) reject(err)
                else resolve(user)
            })
        })
    }

    async getUserFromScreenName(twitter_user_screen_name) {
        return new Promise((resolve, reject) => {
            this.twitter_client.get('users/show', {screen_name: twitter_user_screen_name}, (err, user, response) => {
                if(err) reject(err)
                else resolve(user)
            })
        })
    }

    // ユーザID: {screen_name: ユーザ名, channel_name: チャンネル名}
    async getUserChannelNameMap() {
        const users_id = Object.keys(this.user_channel_id_map)

        if(users_id.length > 0) {
            let user_channel_name_map = {}

            for(let id of users_id) {
                const user = await this.getUserFromId(id)
                const channel = this.discord_client.channels.get(this.user_channel_id_map[id])
                user_channel_name_map[id] = {
                    screen_name: user.screen_name,
                    channel_name: channel.name
                }
            }

            return user_channel_name_map
        }else{
            return {}
        }
    }
}

module.exports = TwitterPipeline