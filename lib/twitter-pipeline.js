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
        this.word_channel_id_map = {}
        this.retry_wait_msec = 1000
    }

    async syncDB() {
        return new Promise(async (resolve, reject) => {
            // 設定されているパイプラインを解除
            await this.stop()

            // DBから読み込んでパイプライン設定
            this.db.find({}, async (err, saved_pipelines) => {
                if(err) reject(err)

                if(saved_pipelines.length > 0) {
                    this.user_channel_id_map = {}
                    this.word_channel_id_map = {}

                    for(let pipeline of saved_pipelines) {
                        switch(pipeline.track_type) {
                            case "user":
                                this.user_channel_id_map[pipeline.track] = pipeline.channel_id
                                break
                            case "word":
                                this.word_channel_id_map[pipeline.track] = pipeline.channel_id
                                break
                            default:
                                continue
                        }
                    }

                    resolve(this.create(this.user_channel_id_map, this.word_channel_id_map))
                }else resolve(false)
            })
        })
    }

    // 監視user_idとchannel_idのマップ, 監視キーワードとchannel_idのマップを元にstreamパイプライン作成
    async create(user_channel_id_map, word_channel_id_map , is_retry=false) {
        // すでにパイプラインが設定されていた場合
        if(this.tweet_stream) this.stop()

        const twitter_users_id = Object.keys(user_channel_id_map)
        const tracking_words = Object.keys(word_channel_id_map)
        if(twitter_users_id.length + tracking_words.length === 0) throw "Can't create empty pipeline"

        this.tweet_stream = this.twitter_client.stream('statuses/filter', { follow: twitter_users_id.join(","), track: tracking_words.join(",")})
        this.tweet_stream.on('data', async tweet => {
            this.retry_wait_msec = 1000 // APIリトライ待機時間をリセット
            // リツイート、引用リツイート、リプライを除外
            if (!tweet.retweeted_status && !tweet.in_reply_to_user_id && !tweet.is_quote_status) {
                const channel_id = user_channel_id_map[tweet.user.id_str] 
                    ? user_channel_id_map[tweet.user.id_str] 
                    : word_channel_id_map[await this.getMathcedMonitoringWord(tweet.text)]

                if(!channel_id) return

                const tweet_url = this.tweet_url
                    .replace("<screen_name>", tweet.user.screen_name)
                    .replace("<tweet_id>", tweet.id_str)

                this.speech.msg(channel_id, tweet_url).catch(err => { console.error("success catch", err) })
            }else {
                console.log("Being retweeted or Replied")
            }
          })

        this.user_channel_id_map = user_channel_id_map
        this.word_channel_id_map = word_channel_id_map

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

    // 監視ワードが含まれてるか検索し見つかったワードを返す
    async getMathcedMonitoringWord(text) {
        const tracking_words = Object.keys(this.word_channel_id_map)
        const regex = new RegExp(tracking_words.join("|"))
        return text.match(regex)[0]
    }

    async stop() {
        return this.tweet_stream ? this.tweet_stream.destroy() : false
    }

    // track中のTwitterユーザIDかワードを渡すと対象レコードを削除
    async delete(track_content) {
        return new Promise((resolve, reject) => {
            this.db.remove({"track": track_content}, {}, (err, removed_count) => {
                if(err) reject(err)
                resolve(removed_count)
            })
        }).then(async removed_count => {
            delete this.user_channel_id_map[track_content]
            delete this.word_channel_id_map[track_content]

            await this.db.persistence.compactDatafile()
            return removed_count
        }).then(async removed_count => {
            await this.syncDB()
            return removed_count
        })
    }

    async add(channel_id, track_content, track_type) {
        return new Promise((resolve, reject) => {
            this.db.count({}, async (err, count) => {
                if(err) reject(err)
                else if(count >= config.twitter_pipeline_limit) {
                    reject(`Twitter pipeline limit.`)
                }else{
                    resolve(null)
                }
            })
        }).then(_ => {
            return new Promise(async (resolve, reject) => {
                this.db.find({ "track": track_content }, (err, records) => {
                    if(err) reject(err)
                    else if(records.length > 0) reject("Twitter pipeline duplicate.")
                    else resolve(null)
                })
            })
        }).then(_ => {
            return new Promise((resolve, reject) => {
                this.db.insert({
                    channel_id: channel_id,
                    track: track_content,
                    track_type: track_type
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

    // ユーザID: {screen_name: ユーザ名, channel_id: チャンネル名}
    async getUserNameChannelIdMap() {
        const users_id = Object.keys(this.user_channel_id_map)

        if(users_id.length > 0) {
            let user_name_channel_id_map = {}

            for(let id of users_id) {
                const user = await this.getUserFromId(id)
                user_name_channel_id_map[id] = {
                    screen_name: user.screen_name,
                    channel_id: this.user_channel_id_map[id]
                }
            }

            return user_name_channel_id_map
        }else{
            return {}
        }
    }
}

module.exports = TwitterPipeline