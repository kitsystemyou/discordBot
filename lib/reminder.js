const schedule = require("node-schedule-tz");
const config = require("../config.json")
const db = require("./database.js").load(config.data_path.reminder)

class Reminder {
    constructor(client, error_handler=(channel_id, err) => {console.log(err)}) {
      this.client = client;
      this.db = db;
      this.speech = new (require("./speech.js"))(client)
      this.error_handler = error_handler
      this.remind_content_registry = null
    }

    async syncDB() {
        return new Promise(async (resolve, reject) => {
            // 現状されているスケジュールを全て解除
            await this.cancelAll()

            // DBから読み込んでスケジュール設定
            this.db.find({}, (err, reminders) => {
                if(err) reject(err)

                resolve(reminders.forEach(reminder => {
                    this.schedule(reminder._id, reminder.channel_id, reminder.cron, reminder.text, reminder.author_id)
                        .catch(err => {this.error_handler(reminder.channel_id, err)})
                }))
            })
        })
    }

    async add(channelId, cronScheme, text, authorId) {
        return new Promise((resolve, reject) => {
            this.db.count({}, (err, count) => {
                if(err) reject(err)
                else if(count >= config.reminder_limit){
                    reject(`Reminder limit: ${config.reminder_limit}`)
                }else{
                    resolve(
                        this.db.insert({
                            channel_id: channelId,
                            cron: cronScheme,
                            text: text,
                            author_id: authorId
                        }, (err, inserted) => {
                            if(err) reject(err)

                            this.schedule(inserted._id, channelId, cronScheme, text, authorId)
                            .catch(err => {this.error_handler(channelId, err)})
                        })
                    )
                }
            })
        })
    }

    async delete(id) {
        return new Promise((resolve, reject) => {
            this.db.remove({_id: id}, {}, (err, removed_count) => {
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

    async get(options={}) {
        return new Promise((resolve, reject) => {
            this.db.find({}, (err, reminders) => {
                if(err) reject(err)
                resolve(reminders)
            })
        })
    }

    async schedule(schedule_id, channel_id, cron_scheme, text, author_id) {
        const author = this.client.users.get(author_id)

        return schedule.scheduleJob("scheduled job", cron_scheme, config.timezone, () => {
            try{
                this.speech.embedMsg(channel_id, {
                    color: config.color.reminder,
                    description: text,
                    author: {
                        name: author.username,
                        icon_url: author.avatarURL
                    },
                    footer: {
                        text: `リマインドID: ${schedule_id}`
                    }
                })
            }catch(err) {
                this.error_handler(channel_id, err)
            }
        });
    }

    async cancelAll() {
        return Object.values(schedule.scheduledJobs).map(job => {
            schedule.cancelJob(job.name);
        })
    }
}

module.exports = Reminder